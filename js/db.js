/**
 * CTE Inteligente - IndexedDB Storage Manager
 * Lógica para la persistencia de datos offline.
 */

class DBManager {
    constructor() {
        this.dbName = 'cte_inteligente';
        this.dbVersion = 2;
        this.db = null;
    }

    /**
     * Inicializa la conexión con IndexedDB
     * @returns {Promise<IDBDatabase>}
     */
    async init() {
        return new Promise((resolve, reject) => {
            if (this.db) {
                resolve(this.db);
                return;
            }

            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = (event) => {
                console.error("Error al abrir IndexedDB:", event.target.error);
                reject(event.target.error);
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                console.log("IndexedDB inicializado correctamente.");
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                console.log(`Actualizando base de datos a la versión ${this.dbVersion}`);

                // Object store: docentes
                if (!db.objectStoreNames.contains('docentes')) {
                    const store = db.createObjectStore('docentes', { keyPath: 'id', autoIncrement: true });
                    store.createIndex('syncStatus', 'syncStatus', { unique: false });
                }

                // Object store: reuniones
                if (!db.objectStoreNames.contains('reuniones')) {
                    const store = db.createObjectStore('reuniones', { keyPath: 'id', autoIncrement: true });
                    store.createIndex('fecha', 'fecha', { unique: false });
                    store.createIndex('estado', 'estado', { unique: false });
                }

                // Object store: segmentos
                // NOTA: IndexedDB soporta nativamente guardar objetos de tipo Blob. 
                // Los audios grabados se pasarán aquí dentro del payload de datos.
                if (!db.objectStoreNames.contains('segmentos')) {
                    const store = db.createObjectStore('segmentos', { keyPath: 'id', autoIncrement: true });
                    store.createIndex('reunionId', 'reunionId', { unique: false });
                }

                // Object store: actas
                if (!db.objectStoreNames.contains('actas')) {
                    const store = db.createObjectStore('actas', { keyPath: 'id', autoIncrement: true });
                    store.createIndex('reunionId', 'reunionId', { unique: true });
                }

                // Object store: ordenDia
                if (!db.objectStoreNames.contains('ordenDia')) {
                    const store = db.createObjectStore('ordenDia', { keyPath: 'id', autoIncrement: true });
                    store.createIndex('reunionId', 'reunionId', { unique: false });
                }
            };
        });
    }

    /**
     * Helper genérico privado para ejecutar transacciones
     */
    _executeTransaction(storeName, mode, callback) {
        return new Promise(async (resolve, reject) => {
            try {
                if (!this.db) await this.init();
                
                const transaction = this.db.transaction([storeName], mode);
                const store = transaction.objectStore(storeName);
                
                let result;
                const request = callback(store);

                if (request) {
                    request.onsuccess = (e) => {
                        result = e.target.result;
                    };
                    request.onerror = (e) => {
                        reject(e.target.error);
                    };
                }

                transaction.oncomplete = () => {
                    resolve(result);
                };

                transaction.onerror = (e) => {
                    console.error(`Error en transacción [${storeName}]:`, e.target.error);
                    reject(e.target.error);
                };
            } catch (error) {
                reject(error);
            }
        });
    }

    // ==========================================
    // OPERACIONES CRUD PÚBLICAS
    // ==========================================

    /**
     * Crear un nuevo registro
     * @param {string} storeName - Nombre del object store
     * @param {Object} data - Objeto a guardar (soporta Blobs para audio)
     * @returns {Promise<number>} - El ID generado
     */
    async add(storeName, data) {
        data.createdAt = new Date().toISOString();
        data.updatedAt = data.createdAt;
        return this._executeTransaction(storeName, 'readwrite', (store) => {
            return store.add(data);
        });
    }

    /**
     * Leer un registro por su ID
     * @param {string} storeName 
     * @param {number|string} id 
     * @returns {Promise<Object>}
     */
    async getById(storeName, id) {
        return this._executeTransaction(storeName, 'readonly', (store) => {
            return store.get(id);
        });
    }

    /**
     * Leer todos los registros de un object store
     * @param {string} storeName 
     * @returns {Promise<Array>}
     */
    async getAll(storeName) {
        return this._executeTransaction(storeName, 'readonly', (store) => {
            return store.getAll();
        });
    }

    /**
     * Leer todos los registros filtrados por un índice
     * @param {string} storeName 
     * @param {string} indexName - Nombre del índice (ej: 'reunionId')
     * @param {any} value - Valor a buscar en el índice
     * @returns {Promise<Array>}
     */
    async getByIndex(storeName, indexName, value) {
        return this._executeTransaction(storeName, 'readonly', (store) => {
            const index = store.index(indexName);
            return index.getAll(value);
        });
    }

    /**
     * Actualizar un registro existente
     * @param {string} storeName 
     * @param {Object} data - Objeto modificado (debe incluir el id)
     * @returns {Promise<void>}
     */
    async update(storeName, data) {
        if (!data.id) {
            throw new Error("Se requiere un 'id' para actualizar el registro.");
        }
        data.updatedAt = new Date().toISOString();
        return this._executeTransaction(storeName, 'readwrite', (store) => {
            return store.put(data);
        });
    }

    /**
     * Eliminar un registro por su ID
     * @param {string} storeName 
     * @param {number|string} id 
     * @returns {Promise<void>}
     */
    async delete(storeName, id) {
        return this._executeTransaction(storeName, 'readwrite', (store) => {
            return store.delete(id);
        });
    }
}

// Exportamos una instancia global para ser utilizada en toda la app
const localDB = new DBManager();
