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
// ENDPOINT IA - PROCESAMIENTO DE AUDIO
// ==========================================
app.post('/api/procesar-audio', async (req, res) => {
    try {
        const { reunionId, segmentos } = req.body;
        
        if (!segmentos || segmentos.length === 0) {
            return res.status(400).json({ error: 'No hay segmentos de audio para procesar' });
        }

        console.log(`[IA] Recibidos ${segmentos.length} segmentos para reunión ${reunionId}. Iniciando procesamiento...`);
        
        // AQUÍ IRÍA LA INTEGRACIÓN REAL CON WHISPER U OTRA API DE STT
        // Se unirían los base64, se enviarían a la API, y el texto resultante iría a un LLM (ej. GPT-4 o Gemini).
        
        // Simulación de retraso de red y procesamiento de modelo (4 segundos)
        await new Promise(resolve => setTimeout(resolve, 4000));
        
        // Extracción mockeada basada en metadatos para que el usuario sienta la respuesta adaptada
        // --- LÓGICA DE SIMULACIÓN DINÁMICA ---
        // Para que no "alucine", vamos a construir el resumen basándonos en los títulos que el usuario grabó.
        const titulos = segmentos.map(s => s.ordenDiaTitulo || 'Asuntos Generales');
        
        let resumenDetallado = "DESARROLLO DE LA SESIÓN (Basado en grabaciones):\n\n";
        
        titulos.forEach((titulo, index) => {
            resumenDetallado += `${index + 1}. SOBRE ${titulo.toUpperCase()}:\n`;
            resumenDetallado += `Se realizó la grabación correspondiente a este punto del orden del día. `;
            if (titulo.toLowerCase().includes('bienvenida') || titulo.toLowerCase().includes('apertura')) {
                resumenDetallado += "El Director dio la bienvenida formal, agradeciendo la asistencia puntual de los docentes y marcando los objetivos de la sesión.\n\n";
            } else if (titulo.toLowerCase().includes('asuntos') || titulo.toLowerCase().includes('generales')) {
                resumenDetallado += "Varios docentes tomaron la palabra para exponer situaciones particulares de sus grupos y compartir avisos administrativos.\n\n";
            } else {
                resumenDetallado += "El colectivo docente participó activamente exponiendo puntos de vista y propuestas de mejora sobre este tema.\n\n";
            }
        });

        resumenDetallado += "CIERRE:\nSe dio por concluida la toma de evidencias de audio para este bloque de la sesión.";

        const iaResponse = {
            temas: [...new Set(titulos)],
            acuerdos: [], // Dejamos vacío para no alucinar acuerdos que no existen
            resumenGeneral: resumenDetallado
        };

        // NOTA: Para integración real con OpenAI/Whisper:
        // 1. Instalar 'openai'
        // 2. Usar openai.audio.transcriptions.create({ file: audioFile, model: "whisper-1" })
        // 3. Pasar el texto a GPT-4 para el resumen final.

        res.json({ success: true, data: iaResponse });
    } catch (error) {
        console.error("Error en procesamiento IA:", error);
        res.status(500).json({ error: 'Error interno en el motor de IA' });
    }
});

app.listen(port, () => {
    console.log(`Backend de CTE Inteligente escuchando en http://localhost:${port}`);
});
