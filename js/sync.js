/**
 * CTE Inteligente - Módulo de Sincronización
 */

class SyncModule {
    constructor() {
        this.apiUrl = `${window.ENV.API_URL}/api`;
        
        // Elementos de UI
        this.btnSync = document.getElementById('btn-sync-now');
        this.syncStatusIcon = document.getElementById('global-sync-status');
        
        if (this.btnSync) {
            this.btnSync.addEventListener('click', () => this.syncAll());
        }

        // Listeners de conexión
        window.addEventListener('online', () => {
            console.log('Conexión restaurada. Intentando sincronizar...');
            this.updateGlobalStatus('pendiente');
            this.syncAll();
        });
        
        window.addEventListener('offline', () => {
            console.log('Conexión perdida. Modo offline.');
            this.updateGlobalStatus('offline');
        });

        // Verificamos estado inicial
        if (!navigator.onLine) {
            this.updateGlobalStatus('offline');
        } else {
            // Revisar si hay pendientes al cargar
            setTimeout(() => this.checkPendingItems(), 1500);
        }
    }

    updateGlobalStatus(status) {
        if (!this.syncStatusIcon) return;
        
        this.syncStatusIcon.className = 'nav-link';
        
        if (status === 'sincronizado') {
            this.syncStatusIcon.innerHTML = '<i class="fa-solid fa-cloud-check" style="color:#10b981;"></i> Nube';
            this.syncStatusIcon.title = "Todo está sincronizado";
        } else if (status === 'pendiente') {
            this.syncStatusIcon.innerHTML = '<i class="fa-solid fa-arrows-rotate fa-spin" style="color:#f59e0b;"></i> Sincronizando...';
            this.syncStatusIcon.title = "Sincronizando datos pendientes";
        } else if (status === 'error') {
            this.syncStatusIcon.innerHTML = '<i class="fa-solid fa-cloud-xmark" style="color:#ef4444;"></i> Error de Sync';
            this.syncStatusIcon.title = "Hubo un error al sincronizar";
        } else if (status === 'offline') {
            this.syncStatusIcon.innerHTML = '<i class="fa-solid fa-wifi-slash" style="color:#6b7280;"></i> Offline';
            this.syncStatusIcon.title = "Sin conexión a internet";
        } else if (status === 'hay_pendientes') {
            this.syncStatusIcon.innerHTML = '<i class="fa-solid fa-cloud-arrow-up" style="color:#3b82f6;"></i> Pendientes';
            this.syncStatusIcon.title = "Hay datos listos para enviar";
        }
    }

    async checkPendingItems() {
        try {
            const reunionesPendientes = await this.getUnsynced('reuniones');
            const segmentosPendientes = await this.getUnsynced('segmentos');
            const actasPendientes = await this.getUnsynced('actas');
            
            const total = reunionesPendientes.length + segmentosPendientes.length + actasPendientes.length;
            
            if (total > 0 && navigator.onLine) {
                this.updateGlobalStatus('hay_pendientes');
            } else if (total === 0 && navigator.onLine) {
                this.updateGlobalStatus('sincronizado');
            }
        } catch (err) {
            console.error("Error al verificar pendientes:", err);
        }
    }

    async getUnsynced(storeName) {
        const all = await localDB.getAll(storeName);
        return all.filter(item => item.syncStatus !== 'sincronizado');
    }

    async markAsSynced(storeName, items, results) {
        for (let item of items) {
            const res = results.find(r => r.localId === item.id);
            if (res) {
                item.syncStatus = 'sincronizado';
                if(res.mongoId) item._id = res.mongoId;
                await localDB.update(storeName, item);
            }
        }
    }

    async syncCollection(storeName) {
        const items = await this.getUnsynced(storeName);
        if (items.length === 0) return true;

        try {
            // Cambiar temporalmente su estado local a enviando (opcional)
            for (let item of items) {
                item.syncStatus = 'pendiente';
                await localDB.update(storeName, item);
            }

            const response = await fetch(`${this.apiUrl}/${storeName}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(items)
            });

            if (response.ok) {
                const data = await response.json();
                await this.markAsSynced(storeName, items, data.synced);
                return true;
            } else {
                throw new Error(`Error del servidor al sincronizar ${storeName}`);
            }
        } catch (error) {
            console.error(`Error en syncCollection(${storeName}):`, error);
            // Revertir a false o pendiente-error
            for (let item of items) {
                item.syncStatus = 'error';
                await localDB.update(storeName, item);
            }
            return false;
        }
    }

    async syncAll() {
        if (!navigator.onLine) {
            alert("No hay conexión a internet para sincronizar.");
            return;
        }

        this.updateGlobalStatus('pendiente');
        
        const btnText = this.btnSync ? this.btnSync.innerHTML : '';
        if(this.btnSync) {
            this.btnSync.disabled = true;
            this.btnSync.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sincronizando...';
        }

        const r1 = await this.syncCollection('reuniones');
        const r2 = await this.syncCollection('segmentos');
        const r3 = await this.syncCollection('actas');

        // Docentes (usando la lógica original pero forzándola en bloque)
        // Ya que el endpoint original es para uno a uno, para esta versión lo omitiremos de la sync global si no lo actualizamos.
        // Pero idealmente, deberíamos adaptarlo. Asumiremos que el frontend guarda docentes al crear.

        if (r1 && r2 && r3) {
            this.updateGlobalStatus('sincronizado');
            if(this.btnSync) {
                this.btnSync.innerHTML = '<i class="fa-solid fa-check"></i> Sincronización Completa';
                setTimeout(() => {
                    this.btnSync.innerHTML = btnText;
                    this.btnSync.disabled = false;
                }, 3000);
            }
        } else {
            this.updateGlobalStatus('error');
            if(this.btnSync) {
                this.btnSync.innerHTML = '<i class="fa-solid fa-xmark"></i> Error al Sincronizar';
                setTimeout(() => {
                    this.btnSync.innerHTML = btnText;
                    this.btnSync.disabled = false;
                }, 3000);
            }
        }
    }
}

let syncModule;
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        syncModule = new SyncModule();
    }, 800);
});
