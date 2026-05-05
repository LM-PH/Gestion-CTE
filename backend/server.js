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
        
        if (!segmentos || segmentos.length === 0) {
            return res.status(400).json({ error: 'No hay segmentos de audio para procesar' });
        }

        console.log(`[IA] Iniciando procesamiento real con Gemini 1.5 Pro para reunión ${reunionId}...`);
        
        // 1. Preparar el modelo
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-pro",
            systemInstruction: `Eres un asistente secretario experto en reuniones de Consejo Técnico Escolar (CTE). 
            Tu objetivo es escuchar los audios proporcionados y generar una redacción profesional, detallada y fiel a lo que se dijo.
            
            REGLAS CRÍTICAS:
            1. NO INVENTES información. Si algo no se menciona en el audio, no lo incluyas.
            2. DESARROLLO DE LA SESIÓN: Debe ser narrativo y cronológico. Menciona intervenciones específicas ("El director dio la bienvenida...", "La maestra X comentó sobre la lectura...", etc.).
            3. ACUERDOS Y COMPROMISOS: Extrae solo los acuerdos explícitos. Si no hubo acuerdos, deja la lista vacía o indica 'No se establecieron acuerdos'.
            4. FORMATO: Responde ÚNICAMENTE en formato JSON con la siguiente estructura:
               {
                 "temas": ["Tema 1", "Tema 2"],
                 "resumenGeneral": "Texto largo con el desarrollo detallado de la sesión...",
                 "acuerdos": [
                   {"texto": "Descripción del acuerdo", "responsable": "Nombre", "fecha": "Fecha o Pendiente"}
                 ]
               }`
        });

        // 2. Convertir segmentos base64 a partes de contenido para Gemini
        const audioParts = segmentos.map(seg => {
            // Extraer solo la data base64 (quitando el prefijo data:audio/webm;base64,)
            const base64Data = seg.audioData.split(',')[1];
            return {
                inlineData: {
                    data: base64Data,
                    mimeType: "audio/webm"
                }
            };
        });

        // 3. Generar contenido
        const prompt = "Analiza estos segmentos de audio de la reunión de CTE. Transcribe lo que dicen los docentes y el director, y genera el resumen detallado y los acuerdos en el formato JSON solicitado.";
        
        const result = await model.generateContent([prompt, ...audioParts]);
        const response = await result.response;
        let text = response.text();
        
        // Limpiar posible formato markdown del JSON si el modelo lo incluye
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        
        try {
            const iaData = JSON.parse(text);
            console.log(`[IA] Procesamiento completado exitosamente para reunión ${reunionId}`);
            res.json({ success: true, data: iaData });
        } catch (parseError) {
            console.error("Error parseando JSON de Gemini:", text);
            // Si falla el parseo, intentamos enviar el texto plano como resumen
            res.json({ 
                success: true, 
                data: {
                    temas: ["Resumen de Sesión"],
                    resumenGeneral: text,
                    acuerdos: []
                }
            });
        }

    } catch (error) {
        console.error("Error en procesamiento Gemini:", error);
        res.status(500).json({ error: 'Error al procesar el audio con Google Gemini API' });
    }
});

app.listen(port, () => {
    console.log(`Backend de CTE Inteligente escuchando en http://localhost:${port}`);
});
