/**
 * CTE Inteligente - Módulo de Reuniones (con Orden del Día)
 */

class ReunionesModule {
    constructor() {
        this.currentReunionId = null;
        
        // --- UI ESTADOS ---
        this.setupState = document.getElementById('reunion-setup-state');
        this.activeState = document.getElementById('reunion-active-state');
        this.viewTitle = document.getElementById('reunion-view-title');
        
        // --- ORDEN DEL DÍA ---
        this.draftAgenda = [];
        this.activeAgendaItems = [];
        this.currentAgendaIndex = 0;
        this.agendaInput = document.getElementById('new-agenda-input');
        this.agendaSetupList = document.getElementById('agenda-setup-list');
        this.currentAgendaDisplay = document.getElementById('current-agenda-display');
        this.agendaProgressText = document.getElementById('agenda-progress-text');

        // --- GRABACIÓN Y UI ---
        this.btnPause = document.getElementById('btn-pause-reunion');
        this.btnResume = document.getElementById('btn-resume-reunion');
        
        this.indicator = document.getElementById('recording-indicator');
        this.timerDisplay = document.getElementById('reunion-timer');
        this.segmentosContainer = document.getElementById('segmentos-container');
        this.segmentosList = document.getElementById('segmentos-list');

        // Estado interno
        this.mediaRecorder = null;
        this.audioStream = null;
        this.audioChunks = [];
        
        this.timerInterval = null;
        this.secondsElapsed = 0;

        // Render inicial vacío
        this.renderDraftAgenda();
    }

    // ==========================================
    // ORDEN DEL DÍA (SETUP)
    // ==========================================
    
    addAgendaItem() {
        const text = this.agendaInput.value.trim();
        if (text) {
            this.draftAgenda.push(text);
            this.agendaInput.value = '';
            this.renderDraftAgenda();
        }
    }

    removeAgendaItem(index) {
        this.draftAgenda.splice(index, 1);
        this.renderDraftAgenda();
    }

    moveAgendaItem(index, direction) {
        if (direction === 'up' && index > 0) {
            const temp = this.draftAgenda[index - 1];
            this.draftAgenda[index - 1] = this.draftAgenda[index];
            this.draftAgenda[index] = temp;
        } else if (direction === 'down' && index < this.draftAgenda.length - 1) {
            const temp = this.draftAgenda[index + 1];
            this.draftAgenda[index + 1] = this.draftAgenda[index];
            this.draftAgenda[index] = temp;
        }
        this.renderDraftAgenda();
    }

    renderDraftAgenda() {
        this.agendaSetupList.innerHTML = '';
        if (this.draftAgenda.length === 0) {
            this.agendaSetupList.innerHTML = '<li style="color:var(--text-muted); font-size:0.9rem; text-align:center; padding: 1rem 0;">No hay puntos agregados.</li>';
            return;
        }
        
        this.draftAgenda.forEach((item, idx) => {
            const li = document.createElement('li');
            li.style.cssText = 'display:flex; justify-content:space-between; align-items:center; background:white; border:1px solid var(--border); padding:0.75rem 1rem; border-radius:var(--radius);';
            li.innerHTML = `
                <div style="display:flex; align-items:center; gap:0.75rem; flex:1;">
                    <span style="background:var(--background); color:var(--text-muted); width:24px; height:24px; border-radius:50%; display:flex; justify-content:center; align-items:center; font-size:0.8rem; font-weight:600;">${idx + 1}</span>
                    <span style="font-weight:500;">${item}</span>
                </div>
                <div style="display:flex; gap:0.25rem;">
                    <button class="btn btn-sm" style="padding:0.25rem 0.5rem; background:transparent;" onclick="reunionesModule.moveAgendaItem(${idx}, 'up')" ${idx === 0 ? 'disabled style="opacity:0.3"' : ''}><i class="fa-solid fa-arrow-up"></i></button>
                    <button class="btn btn-sm" style="padding:0.25rem 0.5rem; background:transparent;" onclick="reunionesModule.moveAgendaItem(${idx}, 'down')" ${idx === this.draftAgenda.length - 1 ? 'disabled style="opacity:0.3"' : ''}><i class="fa-solid fa-arrow-down"></i></button>
                    <button class="btn btn-sm" style="padding:0.25rem 0.5rem; background:transparent; color:#ef4444;" onclick="reunionesModule.removeAgendaItem(${idx})"><i class="fa-solid fa-trash"></i></button>
                </div>
            `;
            this.agendaSetupList.appendChild(li);
        });
    }

    // ==========================================
    // ORDEN DEL DÍA (DURANTE REUNIÓN)
    // ==========================================
    
    updateActiveAgendaUI() {
        if (this.activeAgendaItems.length === 0) {
            this.currentAgendaDisplay.innerText = "Reunión sin orden del día específico.";
            this.agendaProgressText.innerText = "-";
            return;
        }
        
        const current = this.activeAgendaItems[this.currentAgendaIndex];
        this.currentAgendaDisplay.innerText = current.titulo;
        this.agendaProgressText.innerText = `Punto ${this.currentAgendaIndex + 1} de ${this.activeAgendaItems.length}`;
    }

    nextAgendaItem() {
        if (this.currentAgendaIndex < this.activeAgendaItems.length - 1) {
            this.currentAgendaIndex++;
            this.updateActiveAgendaUI();
        }
    }

    prevAgendaItem() {
        if (this.currentAgendaIndex > 0) {
            this.currentAgendaIndex--;
            this.updateActiveAgendaUI();
        }
    }

    // ==========================================
    // LÓGICA DE REUNIÓN Y GRABACIÓN
    // ==========================================

    formatTime(totalSeconds) {
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = totalSeconds % 60;
        return [h, m, s].map(v => v < 10 ? "0" + v : v).join(":");
    }

    updateTimer() {
        this.secondsElapsed++;
        this.timerDisplay.innerText = this.formatTime(this.secondsElapsed);
    }

    async initAudioStream() {
        if (!this.audioStream) {
            this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
    }

    startRecordingChunk() {
        this.audioChunks = [];
        this.mediaRecorder = new MediaRecorder(this.audioStream);
        
        this.mediaRecorder.ondataavailable = e => {
            if (e.data.size > 0) this.audioChunks.push(e.data);
        };

        this.mediaRecorder.onstop = async () => {
            const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            reader.onloadend = async () => {
                const base64Audio = reader.result;
                // Adjuntar el punto de agenda activo al segmento
                const activeAgenda = this.activeAgendaItems[this.currentAgendaIndex];
                
                const segmentoData = {
                    reunionId: this.currentReunionId,
                    ordenDiaId: activeAgenda ? activeAgenda.id : null,
                    ordenDiaTitulo: activeAgenda ? activeAgenda.titulo : 'General',
                    audioData: base64Audio,
                    duracionSecs: this.secondsElapsed
                };
                
                await localDB.add('segmentos', segmentoData);
                this.renderSegmentos();
            };
        };

        this.mediaRecorder.start();
        
        this.indicator.style.color = '#ef4444';
        this.indicator.innerHTML = '<span style="width: 12px; height: 12px; background: #ef4444; border-radius: 50%; display: inline-block;"></span> GRABANDO';
        
        this.timerInterval = setInterval(() => this.updateTimer(), 1000);
    }

    async startReunion() {
        try {
            await this.initAudioStream();
            
            // 1. Crear reunión
            const reunionData = {
                fecha: new Date().toISOString(),
                estado: 'activa'
            };
            this.currentReunionId = await localDB.add('reuniones', reunionData);
            
            // 2. Guardar Orden del Día en DB
            this.activeAgendaItems = [];
            for (let i = 0; i < this.draftAgenda.length; i++) {
                const point = {
                    reunionId: this.currentReunionId,
                    titulo: this.draftAgenda[i],
                    orden: i + 1
                };
                const pointId = await localDB.add('ordenDia', point);
                this.activeAgendaItems.push({ ...point, id: pointId });
            }
            
            // 3. Preparar UI
            this.setupState.style.display = 'none';
            this.activeState.style.display = 'block';
            this.viewTitle.innerText = "Reunión en Curso";
            
            this.currentAgendaIndex = 0;
            this.updateActiveAgendaUI();
            
            this.secondsElapsed = 0;
            this.timerDisplay.innerText = "00:00:00";
            this.segmentosContainer.style.display = 'block';
            this.segmentosList.innerHTML = '';
            
            // 4. Iniciar Grabación
            this.startRecordingChunk();

        } catch (error) {
            alert('No se pudo acceder al micrófono para iniciar la reunión. Revisa los permisos.');
            console.error(error);
        }
    }

    pauseReunion() {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }
        clearInterval(this.timerInterval);
        
        this.indicator.innerHTML = '<span style="width: 12px; height: 12px; background: #f59e0b; border-radius: 50%; display: inline-block;"></span> PAUSADO';
        this.indicator.style.color = '#f59e0b';
        
        this.btnPause.style.display = 'none';
        this.btnResume.style.display = 'inline-flex';
    }

    resumeReunion() {
        this.startRecordingChunk();
        
        this.btnResume.style.display = 'none';
        this.btnPause.style.display = 'inline-flex';
    }

    async endReunion() {
        if (!confirm('¿Estás seguro de finalizar la reunión?')) return;
        
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }
        clearInterval(this.timerInterval);
        
        const reunion = await localDB.getById('reuniones', this.currentReunionId);
        reunion.estado = 'finalizada';
        reunion.duracionTotal = this.secondsElapsed;
        await localDB.update('reuniones', reunion);
        
        // --- NUEVO: Generar Acta Borrador Automáticamente ---
        try {
            const docentes = await localDB.getAll('docentes');
            const participantes = docentes.map(d => d.nombre);
            const ordenDia = this.activeAgendaItems.map(a => a.titulo);

            const nuevaActa = {
                reunionId: reunion.id,
                fecha: reunion.fecha,
                escuela: 'Escuela Primaria', // Puede ser editable luego
                participantes: participantes,
                ordenDia: ordenDia,
                problematicas: [],
                acuerdosList: [],
                estado: 'borrador',
                syncStatus: 'pending_add'
            };
            await localDB.add('actas', nuevaActa);
        } catch (err) {
            console.error("Error generando acta borrador:", err);
        }
        // --------------------------------------------------

        if (this.audioStream) {
            this.audioStream.getTracks().forEach(track => track.stop());
            this.audioStream = null;
        }

        alert('Reunión finalizada y guardada exitosamente.');
        
        // Reset a Estado Setup
        this.currentReunionId = null;
        this.draftAgenda = [];
        this.renderDraftAgenda();
        
        this.activeState.style.display = 'none';
        this.setupState.style.display = 'block';
        this.viewTitle.innerText = "Preparar Reunión CTE";
        this.segmentosContainer.style.display = 'none';
        
        // Reset btns
        this.btnPause.style.display = 'inline-flex';
        this.btnResume.style.display = 'none';
    }

    async renderSegmentos() {
        if (!this.currentReunionId) return;
        
        const segmentos = await localDB.getByIndex('segmentos', 'reunionId', this.currentReunionId);
        this.segmentosList.innerHTML = '';
        
        segmentos.forEach((seg, idx) => {
            const card = document.createElement('div');
            card.style.cssText = 'padding: 1rem; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem; flex-wrap: wrap; gap: 1rem;';
            
            card.innerHTML = `
                <div style="flex: 1; min-width: 200px;">
                    <div style="display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.25rem;">
                        <h4 style="margin: 0;">Segmento #${idx + 1}</h4>
                        <span style="font-size: 0.75rem; background: var(--background); color: var(--text-main); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border);">${seg.ordenDiaTitulo}</span>
                    </div>
                    <p style="font-size: 0.8rem; color: var(--text-muted); margin: 0;">Guardado en el segundo ${seg.duracionSecs}</p>
                </div>
                <div>
                    <audio controls src="${seg.audioData}" style="height: 35px; width: 100%; max-width: 280px;"></audio>
                </div>
            `;
            this.segmentosList.appendChild(card);
        });
    }
}

let reunionesModule;
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        reunionesModule = new ReunionesModule();
    }, 500);
});
