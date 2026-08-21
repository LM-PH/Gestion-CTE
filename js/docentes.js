/**
 * CTE Inteligente - Módulo de Participantes
 * Maneja la lógica de Frontend para listar, crear, editar y eliminar participantes.
 * Sincroniza con MongoDB a través de Node.js y usa IndexedDB como caché offline.
 */

class DocentesModule {
    constructor() {
        this.apiUrl = `${window.ENV.API_URL}/api/docentes`;
        
        // Elementos UI
        this.formContainer = document.getElementById('docentes-form-container');
        this.form = document.getElementById('docentes-form');
        this.grid = document.getElementById('docentes-grid');
        this.emptyState = document.getElementById('docentes-empty-state');
        
        // Cargar lista inicial
        this.loadDocentes();
    }

    /** Muestra/Oculta el formulario */
    toggleForm(reset = true) {
        if (this.formContainer.style.display === 'none') {
            this.formContainer.style.display = 'block';
            if (reset) {
                this.form.reset();
                document.getElementById('docente-id').value = '';
                document.getElementById('docente-mongo-id').value = '';
                document.getElementById('docentes-form-title').innerText = 'Nuevo Participante';
            }
        } else {
            this.formContainer.style.display = 'none';
        }
    }

    /** Guardar o actualizar Participante */
    async saveDocente(e) {
        e.preventDefault();
        
        const localId = document.getElementById('docente-id').value;
        const mongoId = document.getElementById('docente-mongo-id').value;
        
        const docenteData = {
            nombre: document.getElementById('docente-nombre').value,
            cargo: document.getElementById('docente-cargo').value,
            vozBase64: null, // Ya no se incluye registro de voz
            syncStatus: navigator.onLine ? 'synced' : 'pending_add'
        };

        try {
            if (mongoId || localId) {
                // UPDATE (Offline / Online)
                if (localId) docenteData.id = parseInt(localId);
                if (mongoId) docenteData._id = mongoId;
                
                docenteData.syncStatus = navigator.onLine ? 'synced' : 'pending_update';
                await localDB.update('docentes', docenteData);

                if (navigator.onLine && mongoId) {
                    await fetch(`${this.apiUrl}/${mongoId}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(docenteData)
                    });
                }
            } else {
                // CREATE (Offline / Online)
                const insertedId = await localDB.add('docentes', docenteData);
                docenteData.id = insertedId;
                
                if (navigator.onLine) {
                    const response = await fetch(this.apiUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(docenteData)
                    });
                    const savedInMongo = await response.json();
                    
                    // Actualizar el registro local con el ID de Mongo
                    docenteData._id = savedInMongo._id;
                    docenteData.syncStatus = 'synced';
                    await localDB.update('docentes', docenteData);
                }
            }

            this.toggleForm(false); // Ocultar
            this.loadDocentes();
            
        } catch (error) {
            console.error("Error guardando participante:", error);
            alert("Error al guardar. Si estás offline, se guardó localmente.");
            this.toggleForm(false);
            this.loadDocentes();
        }
    }

    /** Eliminar Participante */
    async deleteDocente(localId, mongoId) {
        if (!confirm('¿Seguro que deseas eliminar a este participante?')) return;
        
        try {
            // Eliminar localmente
            if (localId) {
                await localDB.delete('docentes', parseInt(localId));
            }

            // Eliminar en la nube
            if (navigator.onLine && mongoId) {
                await fetch(`${this.apiUrl}/${mongoId}`, { method: 'DELETE' });
            }
            
            this.loadDocentes();
        } catch (error) {
            console.error("Error eliminando participante:", error);
        }
    }

    /** Editar Participante (Carga datos en el form) */
    async editDocente(localId) {
        try {
            const docente = await localDB.getById('docentes', parseInt(localId));
            if (docente) {
                document.getElementById('docente-id').value = docente.id || '';
                document.getElementById('docente-mongo-id').value = docente._id || '';
                
                const nameInput = document.getElementById('docente-nombre');
                nameInput.value = docente.nombre;
                
                document.getElementById('docente-cargo').value = docente.cargo;
                document.getElementById('docentes-form-title').innerText = 'Editar Participante';
                
                this.formContainer.style.display = 'block';
                window.scrollTo(0, 0);
            }
        } catch (error) {
            console.error("Error cargando participante:", error);
        }
    }

    /** Sincronización nube -> local al cargar */
    async syncFromCloud() {
        if (!navigator.onLine) return;

        try {
            const response = await fetch(this.apiUrl);
            if (!response.ok) return;
            const cloudDocentes = await response.json();
            
            const localDocentes = await localDB.getAll('docentes');
            for (let doc of localDocentes) {
                if (doc.syncStatus === 'synced') {
                    await localDB.delete('docentes', doc.id);
                }
            }

            for (let cloudDoc of cloudDocentes) {
                cloudDoc.syncStatus = 'synced';
                await localDB.add('docentes', cloudDoc); // Asignará nuevo ID local, pero conservará _id
            }

        } catch (error) {
            console.error("Fallo la sincronización desde la nube:", error);
        }
    }

    /** Cargar participantes en la UI */
    async loadDocentes() {
        await this.syncFromCloud(); // Intenta bajar los más recientes si hay red

        try {
            const docentes = await localDB.getAll('docentes');
            
            if (docentes.length === 0) {
                this.emptyState.style.display = 'block';
                this.grid.style.display = 'none';
            } else {
                this.emptyState.style.display = 'none';
                this.grid.style.display = 'grid';
                
                this.grid.innerHTML = '';
                docentes.forEach(doc => {
                    const card = document.createElement('div');
                    card.className = 'stat-card'; // reusamos el estilo de la card
                    
                    const offlineBadge = doc.syncStatus !== 'synced' ? `<span style="font-size:0.75rem; background:#f59e0b; color:white; padding:2px 6px; border-radius:4px;">Offline</span>` : '';
                    
                    card.innerHTML = `
                        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                            <div>
                                <h3 style="font-size:1.1rem; margin-bottom:0.25rem;">${doc.nombre} ${offlineBadge}</h3>
                                <p style="color:var(--text-muted); font-size:0.9rem;">${doc.cargo}</p>
                            </div>
                            <div style="display:flex; gap:0.5rem;">
                                <button onclick="docentesModule.editDocente('${doc.id}')" style="border:none; background:none; cursor:pointer; color:var(--primary); font-size:1.1rem;"><i class="fa-solid fa-pen-to-square"></i></button>
                                <button onclick="docentesModule.deleteDocente('${doc.id}', '${doc._id || ''}')" style="border:none; background:none; cursor:pointer; color:#ef4444; font-size:1.1rem;"><i class="fa-solid fa-trash"></i></button>
                            </div>
                        </div>
                    `;
                    this.grid.appendChild(card);
                });
                
                // Update dashboard stat
                const countEl = document.getElementById('dashboard-participantes-count');
                if(countEl) countEl.innerText = docentes.length;
            }
        } catch (error) {
            console.error("Error al cargar la lista de participantes:", error);
        }
    }
}

// Iniciar el módulo
let docentesModule;
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        docentesModule = new DocentesModule();
    }, 500);
});
