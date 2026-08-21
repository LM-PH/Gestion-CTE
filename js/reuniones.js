/**
 * CTE Inteligente - Módulo de Reuniones (con Orden del Día)
 */

class ReunionesModule {
    constructor() {
        this.currentReunionId = null;
        this.extractedDetails = null;
        
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
        // Verificar si no hay stream o si todos sus tracks están inactivos/parados
        const isStreamActive = this.audioStream && 
                               this.audioStream.active && 
                               this.audioStream.getTracks().some(track => track.readyState === 'live');
                               
        if (!isStreamActive) {
            this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
    }

    async startRecordingChunk() {
        try {
            this.audioChunks = [];
            
            // Asegurar que el stream de audio esté re-inicializado y activo (por si se suspendió offline)
            await this.initAudioStream();
            
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
            
            if (this.timerInterval) clearInterval(this.timerInterval);
            this.timerInterval = setInterval(() => this.updateTimer(), 1000);
        } catch (error) {
            console.error("Error al iniciar la grabación:", error);
            alert("Error al acceder al micrófono o reanudar la grabación. Revisa los permisos.");
            
            // Revertir UI
            this.btnPause.style.display = 'none';
            this.btnResume.style.display = 'inline-flex';
            this.indicator.innerHTML = '<span style="width: 12px; height: 12px; background: #ef4444; border-radius: 50%; display: inline-block;"></span> ERROR DE MICRÓFONO';
            this.indicator.style.color = '#ef4444';
            if (this.timerInterval) clearInterval(this.timerInterval);
        }
    }

    async startReunion() {
        try {
            await this.initAudioStream();
            
            const tipoSelect = document.getElementById('reunion-tipo');
            const motivoInput = document.getElementById('reunion-motivo');
            
            // 1. Crear reunión
            const reunionData = {
                fecha: new Date().toISOString(),
                estado: 'activa',
                tipoReunion: tipoSelect ? tipoSelect.value : (this.extractedDetails?.tipoReunion || 'CTE Escolar'),
                motivoReunion: motivoInput ? motivoInput.value.trim() : (this.extractedDetails?.motivoReunion || '')
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

    async resumeReunion() {
        await this.startRecordingChunk();
        
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
                escuela: this.extractedDetails?.escuela || 'Escuela Primaria',
                participantes: this.extractedDetails?.participantes?.length > 0 ? this.extractedDetails.participantes : participantes,
                ordenDia: ordenDia,
                problematicas: [],
                acuerdosList: [],
                estado: 'borrador',
                syncStatus: 'pending_add',
                tipoReunion: reunion.tipoReunion || 'CTE Escolar',
                motivoReunion: reunion.motivoReunion || ''
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
                    <p style="font-size: 0.85rem; color: var(--text-muted); margin: 0;">Guardado en el segundo ${seg.duracionSecs}</p>
                </div>
                <div>
                    <audio controls src="${seg.audioData}" style="height: 35px; width: 100%; max-width: 280px;"></audio>
                </div>
            `;
            this.segmentosList.appendChild(card);
        });
    }

    // ==========================================
    // NUEVAS MEJORAS: PARSEO DE AGENDA Y AUDIOS EXTERNOS
    // ==========================================

    /**
     * Extrae detalles de la reunión a partir del texto de la orden del día
     * @param {string} text 
     */
    extractOrganizationDetails(text) {
        const lines = text.split('\n');
        const details = {
            escuela: '',
            fecha: '',
            participantes: [],
            tipoReunion: '',
            motivoReunion: ''
        };
        
        lines.forEach(line => {
            const clean = line.trim();
            const lower = clean.toLowerCase();
            
            // 1. Detectar Escuela/Plantel
            if (lower.includes('escuela:') || lower.includes('plantel:') || lower.includes('colegio:') || lower.includes('c.c.t:')) {
                const parts = clean.split(/[:\-]/);
                if (parts.length > 1) {
                    details.escuela = parts.slice(1).join(':').trim();
                }
            } else if ((lower.startsWith('escuela ') || lower.startsWith('plantel ')) && clean.length > 8 && clean.length < 60 && !details.escuela) {
                details.escuela = clean;
            }
            
            // 2. Detectar Fecha
            if (lower.includes('fecha:') || lower.includes('día:') || lower.includes('dia:')) {
                const parts = clean.split(/[:\-]/);
                if (parts.length > 1) {
                    details.fecha = parts.slice(1).join(':').trim();
                }
            }
            
            // 3. Detectar Tipo de Reunión
            if (lower.includes('cte de zona') || lower.includes('consejo técnico de zona') || lower.includes('cte zona')) {
                details.tipoReunion = 'CTE de Zona';
            } else if (lower.includes('cte escolar') || lower.includes('consejo técnico escolar') || lower.includes('cte de escuela')) {
                details.tipoReunion = 'CTE Escolar';
            }
            
            // 4. Detectar Motivo / Sesión
            if (lower.includes('sesión ordinaria') || lower.includes('sesion ordinaria')) {
                const match = clean.match(/(\d+ª|primera|segunda|tercera|cuarta|quinta|sexta|séptima|octava)\s+sesi[óo]n\s+ordinaria/i);
                details.motivoReunion = match ? match[0] : 'Sesión Ordinaria';
            } else if (lower.includes('sesión extraordinaria') || lower.includes('sesion extraordinaria')) {
                details.motivoReunion = 'Sesión Extraordinaria';
            }
            
            // 5. Detectar Participantes
            if (lower.includes('participantes:') || lower.includes('asistentes:') || lower.includes('docentes:')) {
                const parts = clean.split(/[:\-]/);
                if (parts.length > 1 && parts[1].trim().length > 3) {
                    const names = parts[1].split(/[,;]/).map(n => n.trim()).filter(n => n.length > 3);
                    details.participantes = details.participantes.concat(names);
                }
            }
        });
        
        this.extractedDetails = details;
        console.log("Detalles extraídos:", details);
        
        // Autocompletar la UI de datos de sesión si se detectaron
        const statusEl = document.getElementById('agenda-file-status');
        if (details.escuela && statusEl) {
            statusEl.innerHTML += `<br/><span style="color:#10b981; font-size:0.8rem; font-weight:600;"><i class="fa-solid fa-circle-check"></i> Plantel detectado: ${details.escuela}</span>`;
        }
        
        if (details.tipoReunion) {
            const tipoSelect = document.getElementById('reunion-tipo');
            if (tipoSelect) tipoSelect.value = details.tipoReunion;
        }
        
        if (details.motivoReunion) {
            const motivoInput = document.getElementById('reunion-motivo');
            if (motivoInput) motivoInput.value = details.motivoReunion;
        }
    }

    /**
     * Procesa el texto extraído de un documento para extraer puntos de la orden del día
     * @param {string} text 
     */
    parseAndAddAgendaText(text) {
        const lines = text.split('\n');
        const items = [];
        
        lines.forEach(line => {
            const clean = line.trim();
            if (clean.length < 4) return; // Ignorar líneas muy cortas
            
            // Limpiar enumeraciones (ej: "1. Introducción", "I. Saludo", "* Acuerdo")
            const cleanedItem = clean
                .replace(/^[\d+A-Za-z]+\.\s*/, '') // Números o letras seguidos de punto
                .replace(/^[-*•]\s*/, '')          // Viñetas comunes
                .trim();
                
            if (cleanedItem.length >= 4) {
                items.push(cleanedItem);
            }
        });
        
        if (items.length > 0) {
            if (confirm(`Se encontraron ${items.length} puntos en el documento. ¿Deseas agregarlos al Orden del Día?`)) {
                this.draftAgenda = this.draftAgenda.concat(items);
                this.renderDraftAgenda();
                
                const statusEl = document.getElementById('agenda-file-status');
                if (statusEl) statusEl.innerText = `¡Cargados ${items.length} puntos con éxito!`;
            }
        } else {
            alert("No se pudo extraer ningún punto claro de orden del día del archivo.");
        }
    }

    /**
     * Maneja la carga de archivos PDF/DOCX para la orden del día
     * @param {Event} event 
     */
    async handleAgendaFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        const statusEl = document.getElementById('agenda-file-status');
        if (statusEl) statusEl.innerText = `Procesando: ${file.name}...`;
        
        const fileExt = file.name.split('.').pop().toLowerCase();
        
        try {
            if (fileExt === 'pdf') {
                const reader = new FileReader();
                reader.onload = async function() {
                    const typedarray = new Uint8Array(this.result);
                    try {
                        const pdfjsLib = window['pdfjs-dist/build/pdf'];
                        // Configurar worker
                        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
                        
                        const pdf = await pdfjsLib.getDocument(typedarray).promise;
                        let fullText = '';
                        for (let i = 1; i <= pdf.numPages; i++) {
                            const page = await pdf.getPage(i);
                            const textContent = await page.getTextContent();
                            const textItems = textContent.items.map(item => item.str);
                            fullText += textItems.join(' ') + '\n';
                        }
                        reunionesModule.parseAndAddAgendaText(fullText);
                        reunionesModule.extractOrganizationDetails(fullText);
                    } catch (e) {
                        console.error("Error leyendo PDF:", e);
                        alert("Error al leer el archivo PDF. Asegúrate de que no tenga protección.");
                        if (statusEl) statusEl.innerText = 'Error al cargar PDF.';
                    }
                };
                reader.readAsArrayBuffer(file);
            } else if (fileExt === 'docx') {
                const reader = new FileReader();
                reader.onload = function(e) {
                    const arrayBuffer = e.target.result;
                    window.mammoth.extractRawText({ arrayBuffer: arrayBuffer })
                        .then(function(result) {
                            reunionesModule.parseAndAddAgendaText(result.value);
                            reunionesModule.extractOrganizationDetails(result.value);
                        })
                        .catch(function(err) {
                            console.error("Error al extraer DOCX:", err);
                            alert("Error al leer el archivo Word.");
                            if (statusEl) statusEl.innerText = 'Error al cargar Word.';
                        });
                };
                reader.readAsArrayBuffer(file);
            } else {
                alert("Formato no soportado. Por favor sube un archivo .pdf o .docx");
                if (statusEl) statusEl.innerText = '';
            }
        } catch (error) {
            console.error("Error en handleAgendaFileUpload:", error);
            if (statusEl) statusEl.innerText = 'Error al procesar archivo.';
        }
        
        event.target.value = '';
    }

    /**
     * Maneja la subida de una grabación externa completa
     * @param {Event} event 
     */
    async handleExternalAudio(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        const statusEl = document.getElementById('audio-file-status');
        if (statusEl) statusEl.innerText = `Procesando grabación completa: ${file.name}... (Este proceso puede tardar unos segundos según el tamaño)`;
        
        try {
            // Convertir archivo a base64
            const base64Audio = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.readAsDataURL(file);
                reader.onload = () => resolve(reader.result);
                reader.onerror = error => reject(error);
            });
            
            if (statusEl) statusEl.innerText = `Guardando en base de datos local...`;
            
            const tipoSelect = document.getElementById('reunion-tipo');
            const motivoInput = document.getElementById('reunion-motivo');
            
            // 1. Crear reunión como finalizada
            const reunionData = {
                fecha: new Date().toISOString(),
                estado: 'finalizada',
                duracionTotal: 0,
                tipoReunion: tipoSelect ? tipoSelect.value : (this.extractedDetails?.tipoReunion || 'CTE Escolar'),
                motivoReunion: motivoInput ? motivoInput.value.trim() : (this.extractedDetails?.motivoReunion || '')
            };
            const reunionId = await localDB.add('reuniones', reunionData);
            
            // 2. Guardar Orden del Día en DB
            const activeAgendaItems = [];
            const agendaTitles = this.draftAgenda.length > 0 ? this.draftAgenda : ['Reunión General'];
            for (let i = 0; i < agendaTitles.length; i++) {
                const point = {
                    reunionId: reunionId,
                    titulo: agendaTitles[i],
                    orden: i + 1
                };
                const pointId = await localDB.add('ordenDia', point);
                activeAgendaItems.push({ ...point, id: pointId });
            }
            
            // 3. Guardar el segmento de audio completo
            const segmentoData = {
                reunionId: reunionId,
                ordenDiaId: null,
                ordenDiaTitulo: 'Grabación Completa',
                audioData: base64Audio,
                duracionSecs: 0
            };
            await localDB.add('segmentos', segmentoData);
            
            // 4. Crear el acta borrador
            const docentes = await localDB.getAll('docentes');
            const participantes = docentes.map(d => d.nombre);
            
            const nuevaActa = {
                reunionId: reunionId,
                fecha: reunionData.fecha,
                escuela: this.extractedDetails?.escuela || 'Escuela Primaria',
                participantes: this.extractedDetails?.participantes?.length > 0 ? this.extractedDetails.participantes : (participantes.length > 0 ? participantes : ['Sin participantes registrados']),
                ordenDia: agendaTitles,
                problematicas: [],
                acuerdosList: [],
                estado: 'borrador',
                syncStatus: 'pending_add',
                tipoReunion: reunionData.tipoReunion,
                motivoReunion: reunionData.motivoReunion
            };
            const actaId = await localDB.add('actas', nuevaActa);
            
            if (statusEl) statusEl.innerText = `¡Grabación importada con éxito! Redirigiendo...`;
            alert('Grabación importada exitosamente. Se ha creado el borrador del acta.');
            
            // Limpiar variables de preparación
            this.draftAgenda = [];
            this.renderDraftAgenda();
            if (statusEl) statusEl.innerText = '';
            event.target.value = '';
            
            // Abrir y cargar el acta recién generada en la pestaña Historial
            if (window.historialModule) {
                await window.historialModule.loadHistorial();
                window.historialModule.viewActa(actaId, reunionId);
            } else {
                app.navigate('view-historial');
            }
            
        } catch (error) {
            console.error("Error importando grabación externa:", error);
            alert("No se pudo importar la grabación: " + (error.message || error));
            if (statusEl) statusEl.innerText = 'Error al importar grabación.';
            event.target.value = '';
        }
    }

    /**
     * Permite subir un archivo de audio para el punto de agenda actual en plena reunión activa
     * @param {Event} event 
     */
    async handleSegmentAudioUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        const statusEl = document.getElementById('segment-audio-status');
        if (statusEl) statusEl.innerText = `Subiendo audio: ${file.name}...`;
        
        try {
            // Si el grabador en vivo está activo, lo pausamos para guardar lo que llevaba hablado
            if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                this.mediaRecorder.stop();
                clearInterval(this.timerInterval);
                
                this.indicator.innerHTML = '<span style="width: 12px; height: 12px; background: #f59e0b; border-radius: 50%; display: inline-block;"></span> PAUSADO';
                this.indicator.style.color = '#f59e0b';
                
                this.btnPause.style.display = 'none';
                this.btnResume.style.display = 'inline-flex';
            }
            
            // Convertir archivo de audio a base64
            const base64Audio = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.readAsDataURL(file);
                reader.onload = () => resolve(reader.result);
                reader.onerror = error => reject(error);
            });
            
            // Obtener el punto de agenda activo
            const activeAgenda = this.activeAgendaItems[this.currentAgendaIndex];
            
            const segmentoData = {
                reunionId: this.currentReunionId,
                ordenDiaId: activeAgenda ? activeAgenda.id : null,
                ordenDiaTitulo: activeAgenda ? activeAgenda.titulo : 'General',
                audioData: base64Audio,
                duracionSecs: this.secondsElapsed
            };
            
            await localDB.add('segmentos', segmentoData);
            await this.renderSegmentos();
            
            if (statusEl) statusEl.innerText = `¡Segmento de audio subido correctamente para el punto actual!`;
            setTimeout(() => { if (statusEl) statusEl.innerText = ''; }, 3000);
            
        } catch (error) {
            console.error("Error al subir audio para el segmento:", error);
            alert("No se pudo procesar el archivo de audio: " + (error.message || error));
            if (statusEl) statusEl.innerText = '';
        }
        
        event.target.value = '';
    }
}

let reunionesModule;
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        reunionesModule = new ReunionesModule();
    }, 500);
});
