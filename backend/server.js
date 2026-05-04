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
        const temasTratados = segmentos.map(s => s.ordenDiaTitulo || 'Asuntos Generales').filter((v, i, a) => a.indexOf(v) === i);
        
        const iaResponse = {
            temas: temasTratados,
            problematicas: [
                "Bajo nivel de comprensión lectora detectado en grupos de primer grado tras la evaluación diagnóstica.",
                "Baja asistencia a las juntas convocadas por la asociación de padres de familia."
            ],
            acuerdos: [
                {
                    texto: "Implementar rutina diaria de 15 minutos de lectura compartida al inicio de la jornada.",
                    responsable: "Todos los docentes frente a grupo",
                    fecha: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] // en 7 días
                },
                {
                    texto: "Enviar citatorios formales para asamblea general de padres enfatizando obligatoriedad.",
                    responsable: "Dirección Escolar",
                    fecha: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] // en 15 días
                }
            ],
            resumenGeneral: "DESARROLLO DE LA SESIÓN:\n\n1. BIENVENIDA Y APERTURA:\nEl Director del plantel inició la sesión a la hora programada, extendiendo una cordial bienvenida a todo el colectivo docente. Expresó el reconocimiento al esfuerzo diario y subrayó la importancia de este espacio para la reflexión pedagógica profunda.\n\n2. INTERVENCIONES DEL COLECTIVO:\n- La Mtra. Adriana (6to Grado) intervino para compartir su preocupación sobre la fluidez lectora en su grupo, sugiriendo la implementación de 'Lecturas de 5 Minutos' al inicio de cada jornada.\n- El Mtro. Roberto (Educación Física) propuso integrar dinámicas de movimiento que refuercen conceptos matemáticos básicos, recibiendo el apoyo de los docentes de primer ciclo.\n- La Mtra. Leticia destacó la mejora en la puntualidad de los alumnos tras las pláticas con padres de familia realizadas el mes anterior.\n\n3. ANÁLISIS DE RESULTADOS:\nEl colectivo revisó las gráficas de aprovechamiento escolar. Se observó una tendencia positiva en el área de ciencias, pero se identificó la necesidad de fortalecer el pensamiento lógico-matemático de manera transversal.\n\n4. CIERRE Y PRÓXIMOS PASOS:\nEl Director agradeció las aportaciones y motivó a los docentes a seguir documentando sus experiencias exitosas. La sesión concluyó con la lectura de los compromisos adquiridos y la firma del acta correspondiente."
        };

        res.json({ success: true, data: iaResponse });
    } catch (error) {
        console.error("Error en procesamiento IA:", error);
        res.status(500).json({ error: 'Error interno en el motor de IA' });
    }
});

app.listen(port, () => {
    console.log(`Backend de CTE Inteligente escuchando en http://localhost:${port}`);
});
