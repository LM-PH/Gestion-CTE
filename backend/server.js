const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(cors());
// Incrementar límite de payload para audios muy largos en base64 (500mb)
app.use(express.json({ limit: '500mb' })); 
app.use(express.urlencoded({ limit: '500mb', extended: true }));

const port = process.env.PORT || 3001;
// Por defecto conecta a localhost si no hay URI
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const dbName = 'cte_inteligente';

let db;

MongoClient.connect(mongoUri)
    .then(client => {
        db = client.db(dbName);
        console.log(`Conectado a MongoDB: ${dbName}`);
    })
    .catch(err => console.error("Error conectando a MongoDB:", err));

// ==========================================
// ENDPOINTS DOCENTES
// ==========================================

// GET /docentes
app.get('/api/docentes', async (req, res) => {
    try {
        const docentes = await db.collection('docentes').find().toArray();
        res.json(docentes);
    } catch (error) {
        console.error("Error GET /docentes:", error);
        res.status(500).json({ error: 'Error obteniendo docentes' });
    }
});

// POST /docentes
app.post('/api/docentes', async (req, res) => {
    try {
        const docenteData = req.body;
        docenteData.createdAt = new Date();
        
        // Si el docente trae ID local temporal (offline), lo guardamos como localId
        if (docenteData.id && typeof docenteData.id === 'number') {
            docenteData.localId = docenteData.id;
            delete docenteData.id; // Para que Mongo asigne un _id ObjectId nativo
        }

        const result = await db.collection('docentes').insertOne(docenteData);
        const savedDocente = await db.collection('docentes').findOne({ _id: result.insertedId });
        
        res.status(201).json(savedDocente);
    } catch (error) {
        console.error("Error POST /docentes:", error);
        res.status(500).json({ error: 'Error guardando docente' });
    }
});

// PUT /docentes/:id
app.put('/api/docentes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = { ...req.body };
        delete updateData._id; // No intentar sobrescribir el _id
        
        updateData.updatedAt = new Date();

        await db.collection('docentes').updateOne(
            { _id: new ObjectId(id) },
            { $set: updateData }
        );
        res.json({ success: true, message: 'Docente actualizado' });
    } catch (error) {
        console.error("Error PUT /docentes:", error);
        res.status(500).json({ error: 'Error actualizando docente' });
    }
});

// DELETE /docentes/:id
app.delete('/api/docentes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await db.collection('docentes').deleteOne({ _id: new ObjectId(id) });
        res.json({ success: true, message: 'Docente eliminado' });
    } catch (error) {
        console.error("Error DELETE /docentes:", error);
        res.status(500).json({ error: 'Error eliminando docente' });
    }
});
// ==========================================
// ENDPOINTS SINCRONIZACIÓN (REUNIONES, SEGMENTOS, ACTAS)
// ==========================================

async function syncCollection(collectionName, payload) {
    const dataArray = Array.isArray(payload) ? payload : [payload];
    const results = [];
    
    for(let data of dataArray) {
        data.updatedAt = new Date();
        const localId = data.id;
        if (data.id && typeof data.id === 'number') {
            data.localId = data.id;
            delete data.id;
        }
        
        let mongoId;
        if (data._id) {
            const _id = new ObjectId(data._id);
            delete data._id;
            await db.collection(collectionName).updateOne({ _id }, { $set: data }, { upsert: true });
            mongoId = _id;
        } else if (data.localId) {
            const result = await db.collection(collectionName).updateOne({ localId: data.localId }, { $set: data }, { upsert: true });
            const doc = await db.collection(collectionName).findOne({ localId: data.localId });
            mongoId = doc._id;
        } else {
            const result = await db.collection(collectionName).insertOne(data);
            mongoId = result.insertedId;
        }
        
        results.push({ localId: localId, mongoId: mongoId });
    }
    return results;
}

app.post('/api/reuniones', async (req, res) => {
    try {
        const results = await syncCollection('reuniones', req.body);
        res.json({ success: true, synced: results });
    } catch (error) {
        console.error("Error POST /reuniones:", error);
        res.status(500).json({ error: 'Error sincronizando reuniones' });
    }
});

app.post('/api/segmentos', async (req, res) => {
    try {
        const results = await syncCollection('segmentos', req.body);
        res.json({ success: true, synced: results });
    } catch (error) {
        console.error("Error POST /segmentos:", error);
        res.status(500).json({ error: 'Error sincronizando segmentos' });
    }
});

app.post('/api/actas', async (req, res) => {
    try {
        const results = await syncCollection('actas', req.body);
        res.json({ success: true, synced: results });
    } catch (error) {
        console.error("Error POST /actas:", error);
        res.status(500).json({ error: 'Error sincronizando actas' });
    }
});
// ==========================================
// ENDPOINT IA - PROCESAMIENTO DE AUDIO (GEMINI 1.5 PRO / FLASH)
// ==========================================
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { GoogleAIFileManager } = require("@google/generative-ai/server");
const fs = require('fs');
const path = require('path');
const os = require('os');

// Inicializar Google AI con la llave desde las variables de entorno
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const fileManager = new GoogleAIFileManager(process.env.GOOGLE_API_KEY);

// Memoria para almacenar el estado de las tareas de IA (Polling)
const audioJobs = new Map();

app.post('/api/upload-chunk', (req, res) => {
    try {
        const { uploadId, chunkIndex, totalChunks, data } = req.body;
        if (!uploadId || !data) return res.status(400).json({ error: 'Faltan parámetros' });
        
        const tempPath = path.join(os.tmpdir(), `upload_${uploadId}.tmp`);
        
        // Append data (chunk base64 string)
        fs.appendFileSync(tempPath, data);
        
        res.json({ success: true, chunkIndex, totalChunks });
    } catch (e) {
        console.error("Error en upload-chunk:", e);
        res.status(500).json({ error: 'Fallo al procesar chunk' });
    }
});

app.post('/api/analizar-pdf', async (req, res) => {
    try {
        const { text } = req.body;
        if (!text) return res.status(400).json({ error: 'No text provided' });
        
        if (!process.env.GOOGLE_API_KEY) {
            return res.status(500).json({ error: 'Falta GOOGLE_API_KEY en el servidor.' });
        }
        
        console.log(`[IA] Analizando documento PDF (${text.length} chars)...`);
        
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash",
            generationConfig: { responseMimeType: "application/json" }
        });
        
        const prompt = `Analiza el siguiente texto extraído de un documento oficial (Agenda o Guía de Consejo Técnico Escolar).
Extrae la información clave y devuélvela en un formato JSON estricto.

Reglas:
1. "propositos": Extrae los propósitos u objetivos generales mencionados en el texto. Resume si es muy largo (un solo párrafo).
2. "organizacion": Extrae la fecha, lugar, sede y/o modalidad si se mencionan. Si no se mencionan, devuelve "No especificado".
3. "temas": Crea una lista con la agenda oficial paso a paso. Para cada tema extrae su Título (obligatorio), Tiempo Asignado (si aplica) y Responsable(s) (si aplica).

Estructura JSON requerida:
{
  "propositos": "Propósitos de la sesión...",
  "organizacion": "Sede: Escuela X, Fecha: Y...",
  "temas": [
    {
      "titulo": "Mensaje de Bienvenida",
      "tiempo": "10 minutos",
      "responsables": "Director"
    }
  ]
}

--- TEXTO DEL DOCUMENTO ---
${text}
---------------------------`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const responseText = response.text();
        
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        const cleanJson = jsonMatch ? jsonMatch[0] : responseText;
        const data = JSON.parse(cleanJson);
        
        res.json({ success: true, data });
    } catch (e) {
        console.error("Error analizando PDF:", e);
        res.status(500).json({ error: 'Fallo al analizar el documento con IA' });
    }
});


app.post('/api/procesar-audio', async (req, res) => {
    try {
        const { reunionId, segmentos, agenda } = req.body;
        console.log(`[IA] Recibida petición para reunión ${reunionId}. Segmentos: ${segmentos?.length}`);

        if (!process.env.GOOGLE_API_KEY) {
            return res.status(500).json({ error: 'Falta GOOGLE_API_KEY en el servidor.' });
        }

        if (!segmentos || segmentos.length === 0) {
            return res.status(400).json({ error: 'No se recibieron audios.' });
        }

        // 1. Generar ID único de tarea para polling
        const taskId = `task_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        
        // 2. Responder de inmediato al frontend para evitar Timeout de Render
        res.json({ success: true, taskId, status: 'processing' });
        
        // Registrar tarea en memoria
        audioJobs.set(taskId, { status: 'processing', progress: 'Iniciando...', data: null, error: null });

        // === PROCESAMIENTO EN SEGUNDO PLANO (Async, sin bloquear la respuesta) ===
        (async () => {
            const uploadedFiles = [];
            try {
                audioJobs.set(taskId, { status: 'processing', progress: 'Ensamblando y subiendo audios a la nube...' });
                
                const model = genAI.getGenerativeModel({ 
                    model: "gemini-2.5-flash",
                    generationConfig: { responseMimeType: "application/json" }
                });

                for (let i = 0; i < segmentos.length; i++) {
                    const seg = segmentos[i];
                    
                    let mimeType = "audio/webm";
                    let base64Data = "";
                    
                    if (seg.isChunked && seg.uploadId) {
                        const assembledPath = path.join(os.tmpdir(), `upload_${seg.uploadId}.tmp`);
                        if (!fs.existsSync(assembledPath)) {
                            throw new Error(`Falta archivo ensamblado para uploadId: ${seg.uploadId}`);
                        }
                        
                        // Leer solo un pedacito para sacar el mimeType
                        const fd = fs.openSync(assembledPath, 'r');
                        const buffer = Buffer.alloc(200);
                        fs.readSync(fd, buffer, 0, 200, 0);
                        fs.closeSync(fd);
                        const headerStr = buffer.toString('utf8');
                        const mimeTypeMatch = headerStr.match(/^data:(audio\/[a-zA-Z0-9.-]+);base64,/);
                        if (mimeTypeMatch) mimeType = mimeTypeMatch[1];
                        
                        // Determinar extensión
                        if (mimeType.includes('m4a') || mimeType.includes('mp4') || mimeType.includes('x-m4a')) {
                            mimeType = 'audio/aac';
                        } else if (mimeType.includes('mpeg')) {
                            mimeType = 'audio/mp3';
                        }
                        const extension = mimeType.split('/')[1] || 'webm';
                        const tempFilePath = path.join(os.tmpdir(), `audio_${taskId}_${i}.${extension}`);
                        
                        // Decodificar Base64 a Binario por Tuberías (Streams) para EVITAR OOM
                        await new Promise((resolve, reject) => {
                            const readStream = fs.createReadStream(assembledPath, { encoding: 'utf8', highWaterMark: 64 * 1024 });
                            const writeStream = fs.createWriteStream(tempFilePath);
                            
                            let headerStripped = false;
                            let leftover = '';

                            readStream.on('data', (chunk) => {
                                let dataToProcess = leftover + chunk;
                                
                                if (!headerStripped) {
                                    const commaIndex = dataToProcess.indexOf(',');
                                    if (commaIndex !== -1) {
                                        dataToProcess = dataToProcess.substring(commaIndex + 1);
                                        headerStripped = true;
                                    } else if (dataToProcess.length > 200) {
                                        headerStripped = true;
                                    } else {
                                        leftover = dataToProcess;
                                        return;
                                    }
                                }
                                
                                const validLength = Math.floor(dataToProcess.length / 4) * 4;
                                const processableData = dataToProcess.substring(0, validLength);
                                leftover = dataToProcess.substring(validLength);
                                
                                if (processableData.length > 0) {
                                    writeStream.write(Buffer.from(processableData, 'base64'));
                                }
                            });

                            readStream.on('end', () => {
                                if (leftover.length > 0) {
                                    writeStream.write(Buffer.from(leftover, 'base64'));
                                }
                                writeStream.end();
                            });
                            
                            writeStream.on('finish', resolve);
                            writeStream.on('error', reject);
                            readStream.on('error', reject);
                        });
                        
                        fs.unlinkSync(assembledPath); // Limpiar ensamblado original
                        console.log(`[IA] Guardado archivo temporal (STREAM): ${tempFilePath} (${mimeType})`);
                        
                        // === SUBIR A GEMINI ===
                        const uploadResponse = await fileManager.uploadFile(tempFilePath, {
                            mimeType: mimeType,
                            displayName: `Audio CTE ${reunionId} - Parte ${i}`
                        });
                        
                        try { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch (e) {}
                        
                        console.log(`[IA] Archivo subido a Gemini. URI: ${uploadResponse.file.uri}`);
                        
                        let fileStatus = await fileManager.getFile(uploadResponse.file.name);
                        while (fileStatus.state === "PROCESSING") {
                            console.log(`[IA] Esperando procesamiento de ${uploadResponse.file.name}...`);
                            await new Promise((resolve) => setTimeout(resolve, 5000));
                            fileStatus = await fileManager.getFile(uploadResponse.file.name);
                        }

                        if (fileStatus.state === "FAILED") {
                            throw new Error("El archivo falló al ser procesado por Google Gemini.");
                        }

                        uploadedFiles.push({ fileData: { fileUri: uploadResponse.file.uri, mimeType: uploadResponse.file.mimeType } });
                        
                    } else if (seg.audioData) {
                        // Flujo antiguo para archivos pequeños no fragmentados
                        const mimeTypeMatch = seg.audioData.match(/^data:(audio\/[a-zA-Z0-9.-]+);base64,/);
                        if (mimeTypeMatch) mimeType = mimeTypeMatch[1];
                        
                        let base64Data;
                        const startIndex = seg.audioData.indexOf('base64,');
                        if (startIndex !== -1) {
                            base64Data = seg.audioData.substring(startIndex + 7);
                        } else {
                            base64Data = seg.audioData;
                        }
                        
                        if (mimeType.includes('m4a') || mimeType.includes('mp4') || mimeType.includes('x-m4a')) {
                            mimeType = 'audio/aac';
                        } else if (mimeType.includes('mpeg')) {
                            mimeType = 'audio/mp3';
                        }

                        const extension = mimeType.split('/')[1] || 'webm';
                        const tempFilePath = path.join(os.tmpdir(), `audio_${taskId}_${i}.${extension}`);
                        
                        fs.writeFileSync(tempFilePath, base64Data, 'base64');
                        base64Data = null; 
                        
                        console.log(`[IA] Guardado archivo temporal (SYNC): ${tempFilePath} (${mimeType})`);

                        const uploadResponse = await fileManager.uploadFile(tempFilePath, {
                            mimeType: mimeType,
                            displayName: `Audio CTE ${reunionId} - Parte ${i}`
                        });
                        
                        try { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch (e) {}
                        
                        console.log(`[IA] Archivo subido a Gemini. URI: ${uploadResponse.file.uri}`);
                        
                        let fileStatus = await fileManager.getFile(uploadResponse.file.name);
                        while (fileStatus.state === "PROCESSING") {
                            console.log(`[IA] Esperando procesamiento de ${uploadResponse.file.name}...`);
                            await new Promise((resolve) => setTimeout(resolve, 5000));
                            fileStatus = await fileManager.getFile(uploadResponse.file.name);
                        }

                        if (fileStatus.state === "FAILED") {
                            throw new Error("El archivo falló al ser procesado por Google Gemini.");
                        }

                        uploadedFiles.push({ fileData: { fileUri: uploadResponse.file.uri, mimeType: uploadResponse.file.mimeType } });
                        
                    } else {
                        continue;
                    }
                }
                if (uploadedFiles.length === 0) {
                    throw new Error("Formato de audio no soportado o vacío.");
                }

                audioJobs.set(taskId, { status: 'processing', progress: 'Generando relatoría con IA (puede tardar minutos)...' });
                console.log(`[IA] Enviando ${uploadedFiles.length} URIs a Gemini...`);

                let prompt = `Actúa como un Secretario Técnico Oficial y riguroso de una sesión de Consejo Técnico Escolar (CTE) en México.
Tu tarea es analizar exhaustivamente la transcripción o el audio de la sesión y generar el contenido para un Acta Oficial.

REGLAS ESTRICTAS E IRROMPIBLES:
1. TODO el contenido generado debe estar en ESPAÑOL (variante de México).
2. IDENTIFICACIÓN DE ORADORES: Escucha con extrema atención para identificar quién está hablando. NO asumas automáticamente que la reunión la lidera "el Director" o "la Directora". Menciona a los participantes por el nombre o cargo con el que se presenten o sean referidos durante la sesión (ej. 'El supervisor', 'La profesora María', 'El ATP').
3. EXTRACCIÓN DE ACUERDOS OBLIGATORIA: Todo compromiso, tarea o propuesta aceptada verbalmente DEBE extraerse y registrarse obligatoriamente en la lista de "acuerdos".
4. EXTENSIÓN Y DETALLE EXHAUSTIVO: Tienes terminantemente prohibido hacer resúmenes excesivos. Tu relatoría (resumenGeneral) debe ser muy extensa, descriptiva y detallada. Mínimo debes escribir un párrafo denso por cada tema discutido, relatando paso a paso cómo se desarrolló la conversación, y reflejando las múltiples voces.
`;

                if (agenda && agenda.trim() !== '') {
                    prompt += `
5. ADHERENCIA A LA ORDEN DEL DÍA (MUY IMPORTANTE): A continuación te proporciono la Orden del Día Oficial (extraída del PDF de la sesión). Es OBLIGATORIO que estructures tu relatoría detallando cómo se desarrolló cada uno de estos puntos durante el audio:
--- ORDEN DEL DÍA OFICIAL ---
${agenda}
-----------------------------
`;
                }

                prompt += `
Genera una respuesta en formato JSON estricto con la siguiente estructura:

{
  "temas": ["Lista detallada y formal de los puntos tratados (basada en el audio y la orden del día)."],
  "resumenGeneral": "Redacta la Relatoría oficial. DEBE SER UN TEXTO LARGO, EXHAUSTIVO Y DETALLADO. Estructúrala punto por punto siguiendo la Orden del Día. Menciona expresamente quién tomó la palabra en cada intervención (ej. la maestra Laura), qué propuso y cómo reaccionaron los demás. No omitas ningún debate o participación importante.",
  "acuerdos": [
    {
      "texto": "Redacción formal, clara y precisa de la acción a realizar.",
      "responsable": "Nombre o cargo específico responsable de cumplirlo.",
      "fecha": "Fecha exacta o 'Pendiente'."
    }
  ]
}`;

                // Ejecutar generación con la API nativa y URIs
                const result = await model.generateContent([prompt, ...uploadedFiles]);
                const response = await result.response;
                const text = response.text();

                console.log(`[IA] Tarea ${taskId} finalizada. Gemini respondió.`);
                
                const jsonMatch = text.match(/\{[\s\S]*\}/);
                const cleanJson = jsonMatch ? jsonMatch[0] : text;

                let iaData;
                try {
                    iaData = JSON.parse(cleanJson);
                } catch (e) {
                    console.warn(`[IA] Error parseando JSON en tarea ${taskId}, enviando texto plano.`);
                    iaData = { temas: ["Resumen"], resumenGeneral: text, acuerdos: [] };
                }

                // Actualizar tarea en memoria como finalizada
                audioJobs.set(taskId, { status: 'completed', data: iaData });

                // Opcional: Limpiar archivos en la nube de Google tras finalizar (recomendado para privacidad y espacio)
                for (let uf of uploadedFiles) {
                    const fname = uf.fileData.fileUri.split('/').pop();
                    try {
                        await fileManager.deleteFile(`files/${fname}`);
                        console.log(`[IA] Archivo remoto files/${fname} eliminado.`);
                    } catch(delErr) {
                        console.warn(`[IA] No se pudo eliminar files/${fname}: ${delErr.message}`);
                    }
                }

            } catch (error) {
                console.error(`[IA] ERROR en tarea ${taskId}:`, error);
                audioJobs.set(taskId, { 
                    status: 'error', 
                    error: error.message || 'Error desconocido procesando audio.' 
                });
                
                // Limpiar temporales si algo falló en medio
                if (uploadedFiles.length === 0) {
                     // Intentar limpiar todos los tmp de este task
                     fs.readdirSync(os.tmpdir()).filter(f => f.includes(`audio_${taskId}`)).forEach(f => {
                         try { fs.unlinkSync(path.join(os.tmpdir(), f)); } catch(e){}
                     });
                }
            }
        })();

    } catch (error) {
        console.error("[IA] CRITICAL ERROR iniciando tarea:", error);
        res.status(500).json({ error: 'Error interno en el servidor', details: error.message });
    }
});

// GET /api/procesar-audio/status/:taskId
// Endpoint para que el Frontend consulte cómo va su tarea asíncrona
app.get('/api/procesar-audio/status/:taskId', (req, res) => {
    const { taskId } = req.params;
    const job = audioJobs.get(taskId);
    
    if (!job) {
        return res.status(404).json({ error: 'Tarea no encontrada o expirada.' });
    }

    if (job.status === 'completed') {
        // Enviar resultado final
        res.json({ success: true, status: 'completed', data: job.data });
        // Limpiar memoria para no llenar la RAM
        audioJobs.delete(taskId);
    } else if (job.status === 'error') {
        res.json({ success: false, status: 'error', error: job.error });
        audioJobs.delete(taskId);
    } else {
        // Aún procesando
        res.json({ success: true, status: 'processing', progress: job.progress });
    }
});

app.listen(port, () => {
    console.log(`Backend de CTE Inteligente escuchando en http://localhost:${port}`);
});
