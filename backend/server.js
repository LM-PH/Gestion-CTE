const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');
const dotenv = require('dotenv');
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const { MercadoPagoConfig, Preference } = require('mercadopago');

dotenv.config();

// Configuración Auth y Pagos
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const JWT_SECRET = process.env.JWT_SECRET || 'secret_para_desarrollo_local';
const mpClient = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN || 'TEST-123' });

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

// Middleware de Autenticación
const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No autorizado' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (e) {
        res.status(401).json({ error: 'Token inválido' });
    }
};

// ==========================================
// ENDPOINTS AUTH
// ==========================================
app.post('/api/auth/google', async (req, res) => {
    try {
        const { token } = req.body;
        const ticket = await googleClient.verifyIdToken({
            idToken: token,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        
        let user = await db.collection('users').findOne({ email: payload.email });
        if (!user) {
            const newUser = {
                email: payload.email,
                name: payload.name,
                picture: payload.picture,
                credits: 0, // Inicia con 0 créditos
                role: 'user',
                createdAt: new Date()
            };
            const result = await db.collection('users').insertOne(newUser);
            user = { _id: result.insertedId, ...newUser };
        }
        
        const jwtToken = jwt.sign(
            { id: user._id.toString(), email: user.email, role: user.role },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        res.json({ success: true, token: jwtToken, user: { name: user.name, email: user.email, picture: user.picture, credits: user.credits, role: user.role } });
    } catch (error) {
        console.error('Error en auth google:', error);
        res.status(401).json({ error: 'Autenticación fallida' });
    }
});

app.post('/api/auth/admin', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (email === 'zlagustin10@gmail.com' && password === 'arrevale321') {
            const jwtToken = jwt.sign(
                { id: 'admin', email: email, role: 'admin' },
                JWT_SECRET,
                { expiresIn: '1d' }
            );
            res.json({ success: true, token: jwtToken, user: { name: 'Admin', email: email, role: 'admin' } });
        } else {
            res.status(401).json({ error: 'Credenciales inválidas' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Error interno' });
    }
});

app.get('/api/admin/users', authMiddleware, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Prohibido' });
    try {
        const users = await db.collection('users').find().toArray();
        for (let user of users) {
            user.actas = await db.collection('reuniones').countDocuments({ userId: user._id.toString() });
        }
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: 'Error obteniendo usuarios' });
    }
});

app.post('/api/auth/me', authMiddleware, async (req, res) => {
    try {
        if (req.user.role === 'admin') {
            return res.json({ name: 'Admin', email: req.user.email, role: 'admin' });
        }
        const user = await db.collection('users').findOne({ _id: new ObjectId(req.user.id) });
        if (!user) return res.status(404).json({ error: 'No encontrado' });
        res.json({ name: user.name, email: user.email, picture: user.picture, credits: user.credits, role: user.role });
    } catch (e) {
        res.status(500).json({ error: 'Error' });
    }
});

// ==========================================
// ENDPOINTS PAGOS (MERCADO PAGO)
// ==========================================
app.post('/api/payments/create-preference', authMiddleware, async (req, res) => {
    try {
        const preference = new Preference(mpClient);
        const result = await preference.create({
            body: {
                items: [
                    {
                        title: '1 Crédito CTE Inteligente',
                        quantity: 1,
                        unit_price: 50.00,
                        currency_id: 'MXN'
                    }
                ],
                metadata: {
                    user_id: req.user.id
                }
            }
        });
        res.json({ id: result.id, init_point: result.init_point });
    } catch (error) {
        console.error('Error creando preferencia MP:', error);
        res.status(500).json({ error: 'Error al generar cobro' });
    }
});

app.post('/api/payments/webhook', async (req, res) => {
    try {
        const payment = req.body;
        console.log("Webhook MP Recibido:", JSON.stringify(payment));
        res.status(200).send('OK');
    } catch (error) {
        console.error('Error en webhook MP:', error);
        res.status(500).send('Error');
    }
});

// Endpoint MOCK temporal para acreditar créditos (Solo para pruebas del cliente)
app.post('/api/payments/mock-success', authMiddleware, async (req, res) => {
    if (req.user.role === 'admin' || !ObjectId.isValid(req.user.id)) return res.status(400).json({ error: 'Inválido' });
    await db.collection('users').updateOne({ _id: new ObjectId(req.user.id) }, { $inc: { credits: 1 } });
    res.json({ success: true, message: 'Crédito añadido exitosamente.' });
});

// ==========================================
// ENDPOINTS DOCENTES
// ==========================================

// GET /docentes
app.get('/api/docentes', authMiddleware, async (req, res) => {
    try {
        const docentes = await db.collection('docentes').find({ userId: req.user.id }).toArray();
        res.json(docentes);
    } catch (error) {
        console.error("Error GET /docentes:", error);
        res.status(500).json({ error: 'Error obteniendo docentes' });
    }
});

// POST /docentes
app.post('/api/docentes', authMiddleware, async (req, res) => {
    try {
        const docenteData = req.body;
        docenteData.createdAt = new Date();
        docenteData.userId = req.user.id;
        
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
app.put('/api/docentes/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'ID inválido' });
        
        const updateData = { ...req.body };
        delete updateData._id; // No intentar sobrescribir el _id
        
        updateData.updatedAt = new Date();

        await db.collection('docentes').updateOne(
            { _id: new ObjectId(id), userId: req.user.id },
            { $set: updateData }
        );
        res.json({ success: true, message: 'Docente actualizado' });
    } catch (error) {
        console.error("Error PUT /docentes:", error);
        res.status(500).json({ error: 'Error actualizando docente' });
    }
});

// DELETE /docentes/:id
app.delete('/api/docentes/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'ID inválido' });
        await db.collection('docentes').deleteOne({ _id: new ObjectId(id), userId: req.user.id });
        res.json({ success: true, message: 'Docente eliminado' });
    } catch (error) {
        console.error("Error DELETE /docentes:", error);
        res.status(500).json({ error: 'Error eliminando docente' });
    }
});
// ==========================================
// ENDPOINTS SINCRONIZACIÓN (REUNIONES, SEGMENTOS, ACTAS)
// ==========================================

async function syncCollection(collectionName, payload, userId) {
    const dataArray = Array.isArray(payload) ? payload : [payload];
    const results = [];
    
    for(let data of dataArray) {
        data.updatedAt = new Date();
        data.userId = userId;
        const localId = data.id;
        if (data.id && typeof data.id === 'number') {
            data.localId = data.id;
            delete data.id;
        }
        
        let mongoId;
        if (data._id) {
            const _id = new ObjectId(data._id);
            delete data._id;
            await db.collection(collectionName).updateOne({ _id, userId }, { $set: data }, { upsert: true });
            mongoId = _id;
        } else if (data.localId) {
            const result = await db.collection(collectionName).updateOne({ localId: data.localId, userId }, { $set: data }, { upsert: true });
            const doc = await db.collection(collectionName).findOne({ localId: data.localId, userId });
            mongoId = doc ? doc._id : null;
        } else {
            const result = await db.collection(collectionName).insertOne(data);
            mongoId = result.insertedId;
        }
        
        results.push({ localId: localId, mongoId: mongoId });
    }
    return results;
}

app.post('/api/reuniones', authMiddleware, async (req, res) => {
    try {
        const results = await syncCollection('reuniones', req.body, req.user.id);
        res.json({ success: true, synced: results });
    } catch (error) {
        console.error("Error POST /reuniones:", error);
        res.status(500).json({ error: 'Error sincronizando reuniones' });
    }
});

app.post('/api/segmentos', authMiddleware, async (req, res) => {
    try {
        const results = await syncCollection('segmentos', req.body, req.user.id);
        res.json({ success: true, synced: results });
    } catch (error) {
        console.error("Error POST /segmentos:", error);
        res.status(500).json({ error: 'Error sincronizando segmentos' });
    }
});

app.post('/api/actas', authMiddleware, async (req, res) => {
    try {
        const results = await syncCollection('actas', req.body, req.user.id);
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
        
        const { SchemaType } = require("@google/generative-ai");

        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash",
            generationConfig: { 
                responseMimeType: "application/json",
                responseSchema: {
                    type: SchemaType.OBJECT,
                    properties: {
                        propositos: {
                            type: SchemaType.STRING,
                            description: "Propósitos u objetivos generales mencionados en el texto. Resume si es muy largo."
                        },
                        sede: {
                            type: SchemaType.STRING,
                            description: "Nombre exclusivo del Plantel o Sede donde se realiza la reunión. Si no se menciona, devuelve cadena vacía."
                        },
                        organizacion: {
                            type: SchemaType.STRING,
                            description: "Extrae la fecha, modalidad u otros datos de organización."
                        },
                        temas: {
                            type: SchemaType.ARRAY,
                            items: {
                                type: SchemaType.OBJECT,
                                properties: {
                                    titulo: { type: SchemaType.STRING, description: "Título del tema (obligatorio)" },
                                    tiempo: { type: SchemaType.STRING, description: "Tiempo asignado (si aplica)" },
                                    responsables: { type: SchemaType.STRING, description: "Responsables (si aplica)" }
                                },
                                required: ["titulo"]
                            },
                            description: "Lista con la agenda oficial paso a paso."
                        }
                    },
                    required: ["propositos", "organizacion", "temas"]
                }
            }
        });
        
        const prompt = `Analiza el siguiente texto extraído de un documento oficial (Agenda o Guía de Consejo Técnico Escolar).
Extrae la información clave.

--- TEXTO DEL DOCUMENTO ---
${text}
---------------------------`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const responseText = response.text();
        
        const data = JSON.parse(responseText);
        
        res.json({ success: true, data });
    } catch (e) {
        console.error("Error analizando PDF:", e);
        res.status(500).json({ error: 'Fallo al analizar el documento con IA' });
    }
});

app.post('/api/cobrar-acta', authMiddleware, async (req, res) => {
    try {
        if (req.user.role === 'admin') {
            return res.json({ success: true, creditsRemaining: 'Ilimitados' });
        }
        if (!ObjectId.isValid(req.user.id)) return res.status(400).json({ error: 'ID de usuario inválido.' });
        
        const user = await db.collection('users').findOne({ _id: new ObjectId(req.user.id) });
        if (!user || user.credits < 1) {
            return res.status(402).json({ error: 'Créditos insuficientes', requirePayment: true });
        }
        
        await db.collection('users').updateOne({ _id: new ObjectId(req.user.id) }, { $inc: { credits: -1 } });
        res.json({ success: true, creditsRemaining: user.credits - 1 });
    } catch (error) {
        console.error("Error en cobrar-acta:", error);
        res.status(500).json({ error: 'Error interno al procesar el cobro.' });
    }
});

app.post('/api/procesar-audio', authMiddleware, async (req, res) => {
    try {
        // --- VERIFICACIÓN DE CRÉDITOS ---
        let user = null;
        const isAdmin = req.user.role === 'admin';

        if (!isAdmin) {
            if (!ObjectId.isValid(req.user.id)) {
                return res.status(400).json({ error: 'ID de usuario inválido.' });
            }

            user = await db.collection('users').findOne({ _id: new ObjectId(req.user.id) });
            if (!user || user.credits < 1) {
                return res.status(402).json({ error: 'Créditos insuficientes', requirePayment: true });
            }
        }
        // --- FIN VERIFICACIÓN ---

        const { reunionId, segmentos, agenda } = req.body;
        console.log(`[IA] Recibida petición para reunión ${reunionId}. Segmentos: ${segmentos?.length}`);

        if (!process.env.GOOGLE_API_KEY) {
            return res.status(500).json({ error: 'Falta GOOGLE_API_KEY en el servidor.' });
        }

        if (!segmentos || segmentos.length === 0) {
            return res.status(400).json({ error: 'No se recibieron audios.' });
        }

        // No descontamos crédito aquí por petición del usuario (se descontará al ver Vista Previa)
        // Solo verificamos que tenga créditos (hecho arriba)

        // 1. Generar ID único de tarea para polling
        const taskId = `task_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        
        // 2. Responder de inmediato al frontend para evitar Timeout de Render
        res.json({ success: true, taskId, status: 'processing', creditsRemaining: isAdmin ? 'Ilimitados' : user.credits });
        
        // Registrar tarea en memoria
        audioJobs.set(taskId, { status: 'processing', progress: 'Iniciando...', data: null, error: null });

        // === PROCESAMIENTO EN SEGUNDO PLANO (Async, sin bloquear la respuesta) ===
        (async () => {
            const uploadedFiles = [];
            try {
                const { SchemaType } = require("@google/generative-ai");

                audioJobs.set(taskId, { status: 'processing', progress: 'Subiendo archivos y procesando con IA...' });
                
                // Inicializar Gemini Pro para análisis profundo
                const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
                const model = genAI.getGenerativeModel({ 
                    model: "gemini-3.1-pro-preview",
                    generationConfig: { 
                        responseMimeType: "application/json",
                        maxOutputTokens: 8192,
                        responseSchema: {
                            type: SchemaType.OBJECT,
                            properties: {
                                temas: {
                                    type: SchemaType.ARRAY,
                                    items: { type: SchemaType.STRING },
                                    description: "Lista de los temas principales de la agenda."
                                },
                                resumenGeneral: {
                                    type: SchemaType.STRING,
                                    description: "Relatoría oficial. Redacta un ensayo narrativo fluido usando dobles saltos de línea para separar párrafos. Usa solo texto puro sin símbolos técnicos."
                                },
                                acuerdos: {
                                    type: SchemaType.ARRAY,
                                    items: {
                                        type: SchemaType.OBJECT,
                                        properties: {
                                            texto: { type: SchemaType.STRING },
                                            responsable: { type: SchemaType.STRING },
                                            fecha: { type: SchemaType.STRING }
                                        }
                                    },
                                    description: "Solo decisiones institucionales mayores. MÁXIMO 10 ELEMENTOS."
                                }
                            },
                            required: ["temas", "resumenGeneral", "acuerdos"]
                        }
                    }
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

                let prompt = `Actúa como Secretario Técnico de un Consejo Técnico Escolar.
Genera el acta de la sesión analizando los audios adjuntos. Te he adjuntado exactamente ${uploadedFiles.length} archivo(s) de audio.

INSTRUCCIONES CLAVES:
1. ENSAYO NARRATIVO: Escribe la relatoría (resumenGeneral) narrando lo que escuchas en formato de ensayo tradicional. Usa texto limpio y separa con dobles saltos de línea. 
2. ESTRUCTURA Y EXTENSIÓN: 
- Estructura la relatoría haciendo un salto de línea y título por cada uno de los ${uploadedFiles.length} archivos de audio adjuntos. 
- Escribe una relatoría altamente detallada, exhaustiva y profesional. Tienes PROHIBIDO hacer resúmenes breves o superficiales.
- SÍNTESIS INTELIGENTE: Si los audios son muy largos, prioriza la información clave y sé conciso. Es ABSOLUTAMENTE CRÍTICO que administres tu extensión para que el formato JSON cierre correctamente y no se corte el texto a la mitad.
- TIENES PROHIBIDO dar por terminada la relatoría hasta que hayas abordado lo sucedido en el ÚLTIMO AUDIO.
3. ACUERDOS Y COMPROMISOS: Extrae los acuerdos, compromisos, tareas y decisiones principales. TIENES PROHIBIDO EXTRAER MÁS DE 10 ACUERDOS. Si hay más, selecciona solo los 10 más importantes.
4. IDENTIFICACIÓN: PROHIBIDO asumir cargos. NO uses las palabras "directora" o "director" a menos que lo digan explícitamente. Usa nombres genéricos ("La persona que coordina", "Un docente") si no se menciona un nombre claro.
`;

                const geminiPayload = [prompt];
                for (let j = 0; j < uploadedFiles.length; j++) {
                    geminiPayload.push({ text: `\n\n--- INICIO DE AUDIO ${j + 1} ---\n` });
                    geminiPayload.push(uploadedFiles[j]);
                    geminiPayload.push({ text: `\n--- FIN DE AUDIO ${j + 1} ---\n` });
                }

                // Ejecutar generación con la API nativa y URIs bien etiquetadas
                const result = await model.generateContent(geminiPayload);
                const text = result.response.text();

                console.log(`[IA] Tarea ${taskId} finalizada. Gemini respondió.`);
                
                let iaData;
                try {
                    iaData = JSON.parse(text);
                    if (iaData.acuerdos && Array.isArray(iaData.acuerdos)) {
                        iaData.acuerdos = iaData.acuerdos.slice(0, 10);
                    }
                } catch (e) {
                    console.warn(`[IA] Error parseando JSON en tarea ${taskId}, intentando rescate manual por corte de tokens.`);
                    
                    let resumen = "";
                    const resMatch = text.match(/"resumenGeneral"\s*:\s*"([\s\S]*?)",?\s*("acuerdos"|})/);
                    if (resMatch) {
                        resumen = resMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
                    } else {
                        const resMatch2 = text.match(/"resumenGeneral"\s*:\s*"([\s\S]*)/);
                        if (resMatch2) {
                            resumen = resMatch2[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
                            resumen = resumen.replace(/["}\]]*$/, '');
                        } else {
                            resumen = text;
                        }
                    }
                    
                    iaData = { temas: [], resumenGeneral: resumen, acuerdos: [] };
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
