const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(cors());
// Incrementar límite de payload para audios en base64
app.use(express.json({ limit: '50mb' })); 

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
// ENDPOINT IA - PROCESAMIENTO DE AUDIO (GEMINI 1.5 PRO)
// ==========================================
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Inicializar Google AI con la llave desde las variables de entorno
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

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

        // 1. Preparar el modelo
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash"
        });

        // 2. Convertir segmentos
        const audioParts = segmentos.map((seg, index) => {
            if (!seg.audioData || !seg.audioData.includes('base64,')) return null;
            return {
                inlineData: {
                    data: seg.audioData.split('base64,')[1],
                    mimeType: "audio/webm"
                }
            };
        }).filter(p => p !== null);

        if (audioParts.length === 0) {
            return res.status(400).json({ error: 'Formato de audio no soportado o vacío.' });
        }

        console.log(`[IA] Enviando ${audioParts.length} partes a Gemini...`);

        const prompt = `Actúa como secretario de una reunión escolar (CTE). 
        Escucha estos audios y genera un acta en JSON con:
        - "temas": Lista de temas.
        - "resumenGeneral": Desarrollo narrativo detallado de la sesión, mencionando quién dijo qué.
        - "acuerdos": Lista de objetos {texto, responsable, fecha}.
        Si no hay acuerdos, deja la lista vacía. No inventes nada.`;

        const result = await model.generateContent([prompt, ...audioParts]);
        const response = await result.response;
        const text = response.text();

        console.log(`[IA] Gemini respondió correctamente.`);
        
        // Limpiar JSON
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        const cleanJson = jsonMatch ? jsonMatch[0] : text;

        try {
            const iaData = JSON.parse(cleanJson);
            res.json({ success: true, data: iaData });
        } catch (e) {
            console.warn("[IA] Error parseando JSON, enviando como texto plano.");
            res.json({ 
                success: true, 
                data: {
                    temas: ["Resumen"],
                    resumenGeneral: text,
                    acuerdos: []
                }
            });
        }

    } catch (error) {
        console.error("[IA] CRITICAL ERROR:", error);
        res.status(500).json({ 
            error: 'Error en el motor de IA', 
            details: error.message || 'Error desconocido'
        });
    }
});

app.listen(port, () => {
    console.log(`Backend de CTE Inteligente escuchando en http://localhost:${port}`);
});
