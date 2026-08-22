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


app.post('/api/procesar-audio', async (req, res) => {
    try {
        const { reunionId, segmentos } = req.body;
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
                audioJobs.set(taskId, { status: 'processing', progress: 'Subiendo archivos a Google Gemini...' });
                
                const model = genAI.getGenerativeModel({ model: "models/gemini-1.5-pro" });

                for (let i = 0; i < segmentos.length; i++) {
                    const seg = segmentos[i];
                    
                    let mimeType = "audio/webm";
                    let base64Data = "";
                    
                    if (seg.isChunked && seg.uploadId) {
                        const assembledPath = path.join(os.tmpdir(), `upload_${seg.uploadId}.tmp`);
                        if (!fs.existsSync(assembledPath)) {
                            throw new Error(`Falta archivo ensamblado para uploadId: ${seg.uploadId}`);
                        }
                        const fullData = fs.readFileSync(assembledPath, 'utf8');
                        const mimeTypeMatch = fullData.match(/^data:(audio\/[a-zA-Z0-9.-]+);base64,/);
                        if (mimeTypeMatch) mimeType = mimeTypeMatch[1];
                        base64Data = fullData.includes('base64,') ? fullData.split('base64,')[1] : fullData;
                        
                        // Limpiar ensamblado
                        fs.unlinkSync(assembledPath);
                    } else if (seg.audioData) {
                        const mimeTypeMatch = seg.audioData.match(/^data:(audio\/[a-zA-Z0-9.-]+);base64,/);
                        if (mimeTypeMatch) mimeType = mimeTypeMatch[1];
                        base64Data = seg.audioData.includes('base64,') ? seg.audioData.split('base64,')[1] : seg.audioData;
                    } else {
                        continue;
                    }
                    
                    if (mimeType.includes('m4a') || mimeType.includes('mp4') || mimeType.includes('x-m4a')) {
                        mimeType = 'audio/aac';
                    } else if (mimeType.includes('mpeg')) {
                        mimeType = 'audio/mp3';
                    }

                    // Escribir archivo temporal a disco
                    const extension = mimeType.split('/')[1] || 'webm';
                    const tempFilePath = path.join(os.tmpdir(), `audio_${taskId}_${i}.${extension}`);
                    
                    fs.writeFileSync(tempFilePath, base64Data, 'base64');
                    console.log(`[IA] Guardado archivo temporal: ${tempFilePath} (${mimeType})`);

                    // Subir usando GoogleAIFileManager (soporta archivos masivos)
                    const uploadResponse = await fileManager.uploadFile(tempFilePath, {
                        mimeType: mimeType,
                        displayName: `Audio CTE ${reunionId} - Parte ${i}`
                    });
                    
                    console.log(`[IA] Archivo subido a Gemini. URI: ${uploadResponse.file.uri}`);
                    
                    // Esperar a que el archivo esté ACTIVO en Gemini
                    let fileStatus = await fileManager.getFile(uploadResponse.file.name);
                    while (fileStatus.state === "PROCESSING") {
                        console.log(`[IA] Esperando procesamiento de ${uploadResponse.file.name}...`);
                        await new Promise((resolve) => setTimeout(resolve, 5000));
                        fileStatus = await fileManager.getFile(uploadResponse.file.name);
                    }

                    if (fileStatus.state === "FAILED") {
                        throw new Error("El archivo falló al ser procesado por Google Gemini.");
                    }

                    uploadedFiles.push({
                        fileData: {
                            fileUri: uploadResponse.file.uri,
                            mimeType: uploadResponse.file.mimeType
                        }
                    });

                    // Limpiar archivo temporal de disco local
                    fs.unlinkSync(tempFilePath);
                }

                if (uploadedFiles.length === 0) {
                    throw new Error("Formato de audio no soportado o vacío.");
                }

                audioJobs.set(taskId, { status: 'processing', progress: 'Generando relatoría con IA (puede tardar minutos)...' });
                console.log(`[IA] Enviando ${uploadedFiles.length} URIs a Gemini...`);

                const prompt = `Actúa como secretario de una reunión escolar de Consejo Técnico Escolar (CTE).
                Analiza con atención el contenido de los audios proporcionados (que corresponden a grabaciones en vivo o audios externos subidos de la sesión). 
                Genera un acta estructurada en formato JSON estricto con los siguientes campos:
                
                {
                  "temas": ["Lista detallada de temas tratados en la reunión"],
                  "resumenGeneral": "Una relatoría narrativa muy detallada e hilada de los hechos ocurridos en la sesión en español. Debe describir a profundidad lo discutido, mencionando qué participante intervino, qué propuestas hicieron y cómo se desarrolló la discusión punto por punto de la orden del día. El texto debe ser formal, explicativo y servir como testimonio completo de la reunión escolar.",
                  "acuerdos": [
                    {
                      "texto": "Detalle claro y completo del acuerdo, compromiso o tarea asignada",
                      "responsable": "Nombre del participante, equipo o grupo responsable (ej. Director, Todo el colectivo, Profesor Juan)",
                      "fecha": "Plazo límite de cumplimiento (ej. Próxima sesión, fecha exacta DD/MM/AAAA, o 'Pendiente')"
                    }
                  ]
                }
                
                Asegúrate de extraer TODOS los compromisos, tareas y acuerdos que se hayan pactado. Si no se tomaron acuerdos en absoluto, deja la lista de acuerdos vacía. No inventes información que no esté en los audios.`;

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
