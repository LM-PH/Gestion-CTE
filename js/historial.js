/**
 * CTE Inteligente - Módulo de Historial y Actas
 */

class HistorialModule {
    constructor() {
        this.historialList = document.getElementById('historial-list');
        this.emptyState = document.getElementById('historial-empty-state');
        
        // Elementos del Acta
        this.actaIdInput = document.getElementById('current-acta-id');
        this.actaEscuela = document.getElementById('acta-escuela');
        this.actaEscuelaPrint = document.getElementById('acta-escuela-print');
        this.actaFecha = document.getElementById('acta-fecha');
        
        this.actaParticipantesInput = document.getElementById('acta-participantes-input');
        this.actaParticipantesPrint = document.getElementById('acta-participantes-print');
        
        this.actaOrdenInput = document.getElementById('acta-orden-input');
        this.actaOrdenPrint = document.getElementById('acta-orden-print');
        
        this.actaProblematicasInput = document.getElementById('acta-problematicas-input');
        this.actaProblematicasPrint = document.getElementById('acta-problematicas-print');
        
        this.actaResumenInput = document.getElementById('acta-resumen-input');
        this.actaResumenPrint = document.getElementById('acta-resumen-print');
        
        this.acuerdosListTbody = document.getElementById('acta-acuerdos-list');
        
        this.actaAudios = document.getElementById('acta-audios');
        this.statusBadge = document.getElementById('acta-status-badge');
        this.watermark = document.getElementById('acta-watermark');
        this.btnAprobarContainer = document.getElementById('aprobar-container');
        this.btnIaMagic = document.getElementById('btn-ia-magic');

        // Estado local de los acuerdos
        this.currentAcuerdos = [];

        // Escuchar navegación
        document.querySelectorAll('.nav-link[data-target="view-historial"]').forEach(el => {
            el.addEventListener('click', () => this.loadHistorial());
        });
        
        this.loadHistorial();
    }

    formatDate(isoString) {
        const date = new Date(isoString);
        return date.toLocaleDateString('es-MX', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    async loadHistorial() {
        try {
            const reuniones = await localDB.getAll('reuniones');
            const finalizadas = reuniones
                .filter(r => r.estado === 'finalizada')
                .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

            if (finalizadas.length === 0) {
                this.emptyState.style.display = 'block';
                this.historialList.style.display = 'none';
                return;
            }

            this.emptyState.style.display = 'none';
            this.historialList.style.display = 'flex';
            this.historialList.innerHTML = '';

            for (const r of finalizadas) {
                const card = document.createElement('div');
                card.className = 'card';
                card.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';
                
                const actas = await localDB.getByIndex('actas', 'reunionId', r.id);
                const tieneActa = actas.length > 0;
                let estadoColor = 'var(--text-muted)';
                let estadoText = 'Borrador';

                if (tieneActa && actas[0].estado === 'aprobada') {
                    estadoColor = '#10b981';
                    estadoText = 'Aprobada';
                }

                card.innerHTML = `
                    <div>
                        <h3 style="color: var(--text-main); margin-bottom: 0.25rem;">Sesión del ${new Date(r.fecha).toLocaleDateString('es-MX')}</h3>
                        <p style="color: var(--text-muted); font-size: 0.9rem;">
                            <i class="fa-regular fa-clock"></i> Grabada a las ${new Date(r.fecha).toLocaleTimeString('es-MX', {hour:'2-digit', minute:'2-digit'})} 
                            | Estado: <span style="color:${estadoColor}; font-weight:600;">${estadoText}</span>
                        </p>
                    </div>
                    <div style="display: flex; gap: 0.5rem; align-items: center;">
                        ${tieneActa 
                            ? `<button class="btn btn-primary" onclick="historialModule.viewActa(${actas[0].id}, ${r.id})"><i class="fa-solid fa-file-signature"></i> Editar/Ver Acta</button>`
                            : `<span style="color: #ef4444; font-size: 0.85rem; margin-right: 0.5rem;"><i class="fa-solid fa-triangle-exclamation"></i> Error: Acta no generada</span>`
                        }
                        <button class="btn" style="background: transparent; color: #ef4444; padding: 0.5rem; border: 1px solid #fee2e2;" onclick="historialModule.deleteReunion(${r.id})" title="Eliminar Reunión">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                `;
                this.historialList.appendChild(card);
            }
        } catch (error) {
            console.error("Error cargando el historial:", error);
        }
    }

    async deleteReunion(reunionId) {
        if (!confirm('¿Estás seguro de que deseas eliminar esta reunión y toda su información (acta, audios, etc.)? Esta acción no se puede deshacer.')) return;
        
        try {
            // 1. Eliminar de 'reuniones'
            await localDB.delete('reuniones', reunionId);
            
            // 2. Eliminar acta asociada
            const actas = await localDB.getByIndex('actas', 'reunionId', reunionId);
            for (let a of actas) {
                await localDB.delete('actas', a.id);
            }
            
            // 3. Eliminar segmentos de audio asociados
            const segmentos = await localDB.getByIndex('segmentos', 'reunionId', reunionId);
            for (let s of segmentos) {
                await localDB.delete('segmentos', s.id);
            }
            
            // 4. Eliminar puntos de orden del día asociados
            const ordenDia = await localDB.getByIndex('ordenDia', 'reunionId', reunionId);
            for (let o of ordenDia) {
                await localDB.delete('ordenDia', o.id);
            }

            alert('Reunión eliminada exitosamente.');
            this.renderHistorialList();
        } catch (err) {
            console.error("Error al eliminar la reunión:", err);
            alert('Hubo un error al intentar eliminar la reunión: ' + (err.message || err));
        }
    }


    async viewActa(actaId, reunionId) {
        try {
            const acta = await localDB.getById('actas', actaId);
            if (!acta) return;

            // Migraciones
            if (!acta.acuerdosList) acta.acuerdosList = [];
            if (!acta.problematicas) acta.problematicas = [];

            this.actaIdInput.value = acta.id;
            this.actaIdInput.dataset.reunionId = reunionId;
            this.actaEscuela.value = acta.escuela || '';
            this.actaFecha.innerText = this.formatDate(acta.fecha);
            
            // Textareas
            this.actaParticipantesInput.value = acta.participantes.join('\n');
            this.actaOrdenInput.value = acta.ordenDia.join('\n');
            this.actaProblematicasInput.value = acta.problematicas.join('\n');
            this.actaResumenInput.value = acta.resumen || '';
            
            this.currentAcuerdos = acta.acuerdosList;
            this.renderAcuerdosTable();

            if (acta.estado === 'aprobada') {
                this.statusBadge.innerText = 'ACTA APROBADA';
                this.statusBadge.style.background = '#d1fae5';
                this.statusBadge.style.color = '#065f46';
                this.watermark.style.display = 'none';
                this.btnAprobarContainer.style.display = 'none';
                document.getElementById('acuerdos-form-container').style.display = 'none';
                this.btnIaMagic.style.display = 'none';
            } else {
                this.statusBadge.innerText = 'BORRADOR';
                this.statusBadge.style.background = '#fee2e2';
                this.statusBadge.style.color = '#991b1b';
                this.watermark.style.display = 'block';
                this.btnAprobarContainer.style.display = 'block';
                document.getElementById('acuerdos-form-container').style.display = 'block';
                this.btnIaMagic.style.display = 'inline-flex';
            }

            this.syncPrintElements();

            // Cargar audios
            this.actaAudios.innerHTML = '';
            const segmentos = await localDB.getByIndex('segmentos', 'reunionId', reunionId);
            if(segmentos.length === 0) {
                this.actaAudios.innerHTML = '<p style="color:var(--text-muted); font-size:0.9rem;">No hay evidencias de audio para esta sesión.</p>';
            } else {
                segmentos.forEach((seg, idx) => {
                    this.actaAudios.innerHTML += `
                        <div style="display:flex; align-items:center; justify-content:space-between; background:white; padding:0.5rem 1rem; border-radius:4px; border:1px solid var(--border);">
                            <span style="font-size:0.9rem; font-weight:500;">Punto: ${seg.ordenDiaTitulo || 'General'}</span>
                            <audio controls src="${seg.audioData}" style="height:30px; width:200px;"></audio>
                        </div>
                    `;
                });
            }

            app.navigate('view-acta');
            window.scrollTo(0, 0);

        } catch (error) {
            console.error("Error cargando el acta:", error);
        }
    }

    async procesarConIA() {
        const reunionId = parseInt(this.actaIdInput.dataset.reunionId);
        if (!reunionId) return;

        const originalText = this.btnIaMagic.innerHTML;
        this.btnIaMagic.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando Audio...';
        this.btnIaMagic.disabled = true;

        try {
            // Obtenemos los segmentos de la base local
            const segmentos = await localDB.getByIndex('segmentos', 'reunionId', reunionId);
            
            // Llamada al backend
            const response = await fetch(`${window.ENV.API_URL}/api/procesar-audio`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reunionId, segmentos })
            });

            if (!response.ok) throw new Error("Fallo en la comunicación con IA");

            const { data } = await response.json();
            
            // Autocompletamos los campos del acta con los datos de la IA
            if (data.temas && data.temas.length > 0) {
                this.actaOrdenInput.value = data.temas.join('\n');
            }
            if (data.problematicas && data.problematicas.length > 0) {
                this.actaProblematicasInput.value = data.problematicas.join('\n');
            }
            if (data.resumenGeneral) {
                this.actaResumenInput.value = data.resumenGeneral;
            }
            if (data.acuerdos && data.acuerdos.length > 0) {
                data.acuerdos.forEach(ac => {
                    this.currentAcuerdos.push({
                        id: Date.now() + Math.random(),
                        texto: ac.texto,
                        responsable: ac.responsable,
                        fecha: ac.fecha
                    });
                });
                this.renderAcuerdosTable();
            }

            // Guardamos todo en la BD local
            await this.saveActaChanges(false);
            alert("¡El asistente de IA ha autocompletado tu acta basándose en el audio de la sesión!");

        } catch (err) {
            console.error("Error procesando con IA:", err);
            alert("Hubo un error al conectar con el servicio de IA. Inténtalo más tarde.");
        } finally {
            this.btnIaMagic.innerHTML = originalText;
            this.btnIaMagic.disabled = false;
        }
    }

    previewPDF() {
        this.syncPrintElements();
        window.print(); // Se apoya en el CSS @media print
    }

    async downloadPDF() {
        this.syncPrintElements();
        
        const element = document.getElementById('acta-document-container');
        
        // Manejo temporal del DOM para que html2pdf renderice solo lo de "print"
        const noPrintElements = element.querySelectorAll('.no-print');
        const printOnlyElements = element.querySelectorAll('.print-only');
        
        const originalNoPrint = [];
        const originalPrintOnly = [];

        noPrintElements.forEach(el => {
            originalNoPrint.push(el.style.display);
            el.style.display = 'none';
        });

        printOnlyElements.forEach(el => {
            originalPrintOnly.push(el.style.display);
            el.style.display = 'block';
        });

        const safeDate = this.actaFecha.innerText.replace(/[^a-zA-Z0-9]/g, '_');
        
        const opt = {
            margin:       10,
            filename:     `Acta_CTE_${safeDate}.pdf`,
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { scale: 2, useCORS: true },
            jsPDF:        { unit: 'mm', format: 'letter', orientation: 'portrait' }
        };

        const originalBadge = this.statusBadge.innerText;
        this.statusBadge.innerText = "Generando PDF...";

        try {
            await html2pdf().set(opt).from(element).save();
        } catch(e) {
            console.error("Error al generar PDF: ", e);
            alert("Hubo un error al generar el PDF.");
        } finally {
            // Restaurar estado visual del DOM
            noPrintElements.forEach((el, i) => el.style.display = originalNoPrint[i]);
            printOnlyElements.forEach((el, i) => el.style.display = originalPrintOnly[i]);
            this.statusBadge.innerText = originalBadge;
        }
    }

    addAcuerdo() {
        const texto = document.getElementById('nuevo-acuerdo-texto').value.trim();
        const resp = document.getElementById('nuevo-acuerdo-resp').value.trim();
        const fecha = document.getElementById('nuevo-acuerdo-fecha').value;

        if (!texto) {
            alert('Por favor describe el acuerdo.');
            return;
        }

        this.currentAcuerdos.push({
            id: Date.now(),
            texto,
            responsable: resp || 'Colegiado',
            fecha: fecha || 'Pendiente'
        });

        document.getElementById('nuevo-acuerdo-texto').value = '';
        document.getElementById('nuevo-acuerdo-resp').value = '';
        document.getElementById('nuevo-acuerdo-fecha').value = '';

        this.renderAcuerdosTable();
        this.saveActaChanges(false);
    }

    removeAcuerdo(id) {
        this.currentAcuerdos = this.currentAcuerdos.filter(a => a.id !== id);
        this.renderAcuerdosTable();
        this.saveActaChanges(false);
    }

    renderAcuerdosTable() {
        this.acuerdosListTbody.innerHTML = '';
        if (this.currentAcuerdos.length === 0) {
            this.acuerdosListTbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 1rem; color: #666; font-style: italic;">Sin acuerdos registrados aún.</td></tr>';
            return;
        }

        this.currentAcuerdos.forEach(a => {
            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid #eee';
            tr.innerHTML = `
                <td style="padding: 0.75rem 0;">${a.texto}</td>
                <td style="padding: 0.75rem 0;">${a.responsable}</td>
                <td style="padding: 0.75rem 0;">${a.fecha}</td>
                <td class="no-print" style="padding: 0.75rem 0; text-align: right;">
                    <button class="btn btn-sm" style="background:transparent; color:#ef4444;" onclick="historialModule.removeAcuerdo(${a.id})"><i class="fa-solid fa-trash"></i></button>
                </td>
            `;
            this.acuerdosListTbody.appendChild(tr);
        });
    }

    syncPrintElements() {
        this.actaEscuelaPrint.innerText = this.actaEscuela.value || '______________';
        
        const partText = this.actaParticipantesInput.value;
        const participantesArr = partText.split('\n').filter(p => p.trim() !== '');
        this.actaParticipantesPrint.innerHTML = participantesArr.map(p => `<li>${p}</li>`).join('');

        const ordenText = this.actaOrdenInput.value;
        this.actaOrdenPrint.innerHTML = ordenText.split('\n').filter(o => o.trim() !== '').map(o => `<li>${o}</li>`).join('');

        const probText = this.actaProblematicasInput.value;
        this.actaProblematicasPrint.innerHTML = probText.split('\n').filter(o => o.trim() !== '').map(o => `<li>${o}</li>`).join('');

        this.actaResumenPrint.innerText = this.actaResumenInput.value;

        // Lógica de generación de firmas dinámicas
        const firmasGrid = document.getElementById('acta-firmas-grid');
        const numFirmasInput = document.getElementById('acta-numero-firmas');
        
        // Si el usuario no ha tocado el input manualmente (o si está generando la vista), 
        // sugerimos el número de participantes como default
        let totalFirmas = parseInt(numFirmasInput.value) || 2;
        
        // Si la cantidad de participantes es mayor, actualizamos el input para ayudar al usuario
        if (participantesArr.length > 0 && document.activeElement !== numFirmasInput) {
             numFirmasInput.value = participantesArr.length;
             totalFirmas = participantesArr.length;
        }

        firmasGrid.innerHTML = '';
        for (let i = 0; i < totalFirmas; i++) {
            const nombre = participantesArr[i] || '_________________________';
            firmasGrid.innerHTML += `
                <div style="text-align: center; width: 30%; min-width: 200px; margin-bottom: 2rem;">
                    <div style="border-bottom: 1px solid #000; width: 100%; height: 3rem;"></div>
                    <p style="margin-top: 0.5rem; font-weight: bold; font-family: serif; font-size: 0.9rem;">${nombre}</p>
                </div>
            `;
        }
    }

    async saveActaChanges(showToast = true) {
        try {
            const actaId = parseInt(this.actaIdInput.value);
            if (!actaId) return;

            const acta = await localDB.getById('actas', actaId);
            if (acta) {
                acta.escuela = this.actaEscuela.value;
                
                const rawParticipantes = this.actaParticipantesInput.value.split('\n').map(l => l.trim()).filter(l => l !== '');
                acta.participantes = rawParticipantes.length > 0 ? rawParticipantes : ['Sin participantes'];

                const rawOrden = this.actaOrdenInput.value.split('\n').map(l => l.trim()).filter(l => l !== '');
                acta.ordenDia = rawOrden.length > 0 ? rawOrden : ['General'];
                
                const rawProb = this.actaProblematicasInput.value.split('\n').map(l => l.trim()).filter(l => l !== '');
                acta.problematicas = rawProb;

                acta.resumen = this.actaResumenInput.value;

                acta.acuerdosList = this.currentAcuerdos;

                // Forzamos sync para la próxima vez
                if(acta.estado !== 'aprobada' && navigator.onLine && syncModule) {
                   acta.syncStatus = 'pendiente';
                }

                await localDB.update('actas', acta);
                this.syncPrintElements();
                
                if(showToast) alert("Todos los cambios guardados correctamente.");
            }
        } catch (error) {
            console.error("Error guardando cambios del acta:", error);
            if(showToast) alert("Hubo un error al guardar los cambios.");
        }
    }

    async aprobarActa() {
        if(!confirm("¿Estás seguro de aprobar esta acta? Se marcará como documento final.")) return;
        
        await this.saveActaChanges(false);

        try {
            const actaId = parseInt(this.actaIdInput.value);
            const acta = await localDB.getById('actas', actaId);
            acta.estado = 'aprobada';
            acta.syncStatus = 'pendiente'; // Se enviará aprobada a la nube
            
            await localDB.update('actas', acta);
            
            alert("El acta ha sido aprobada exitosamente.");
            
            if(syncModule) syncModule.checkPendingItems(); // Intenta sincronizar rápido

            this.loadHistorial();
            this.viewActa(acta.id, acta.reunionId); // Recargar
        } catch (error) {
            console.error("Error aprobando acta:", error);
        }
    }
}

let historialModule;
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        historialModule = new HistorialModule();
    }, 600);
});
