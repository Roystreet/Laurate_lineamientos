CREATE TABLE IF NOT EXISTS coordinacion (id INT PRIMARY KEY) ENGINE=InnoDB;
INSERT IGNORE INTO coordinacion VALUES (1);
CREATE TABLE IF NOT EXISTS requerimientos (
 id CHAR(36) PRIMARY KEY, codigo VARCHAR(64) COLLATE utf8mb4_bin NOT NULL UNIQUE,
 version_actual CHAR(36), documento_ficha_actual CHAR(36), created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS documentos (
 id CHAR(36) PRIMARY KEY, requerimiento_id CHAR(36) NOT NULL, clase VARCHAR(16) NOT NULL,
 nombre_original VARCHAR(255) NOT NULL, version_actual CHAR(36), created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY (requerimiento_id) REFERENCES requerimientos(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS versiones_documento (
 id CHAR(36) PRIMARY KEY, documento_id CHAR(36) NOT NULL, nombre_original VARCHAR(255), original_path TEXT NOT NULL,
 sha256 CHAR(64) NOT NULL, estado VARCHAR(24) NOT NULL DEFAULT 'queued', force_ocr BOOLEAN DEFAULT FALSE,
 texto LONGTEXT, markdown LONGTEXT, metadata JSON, configuracion JSON NOT NULL, error TEXT,
 created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3), FOREIGN KEY (documento_id) REFERENCES documentos(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS versiones_requerimiento (
 id CHAR(36) PRIMARY KEY, requerimiento_id CHAR(36) NOT NULL, documento_version_id CHAR(36) NOT NULL,
 ficha JSON NOT NULL, created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY (requerimiento_id) REFERENCES requerimientos(id), FOREIGN KEY (documento_version_id) REFERENCES versiones_documento(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS consideraciones (
 id CHAR(36) PRIMARY KEY, version_requerimiento_id CHAR(36) NOT NULL, orden INT NOT NULL, texto LONGTEXT NOT NULL,
 UNIQUE(version_requerimiento_id, orden), FOREIGN KEY (version_requerimiento_id) REFERENCES versiones_requerimiento(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS relaciones_requerimiento (
 version_requerimiento_id CHAR(36) NOT NULL, orden INT NOT NULL, codigo VARCHAR(64) NOT NULL,
 PRIMARY KEY(version_requerimiento_id, orden), FOREIGN KEY (version_requerimiento_id) REFERENCES versiones_requerimiento(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS paginas_documento (
 documento_version_id CHAR(36) NOT NULL, numero INT NOT NULL, metodo VARCHAR(16) NOT NULL,
 estado VARCHAR(24) NOT NULL, texto LONGTEXT NOT NULL, texto_nativo LONGTEXT, imagen_path TEXT, error TEXT,
 PRIMARY KEY(documento_version_id, numero), FOREIGN KEY (documento_version_id) REFERENCES versiones_documento(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS requerimiento_evidencias (
 id CHAR(36) PRIMARY KEY, requerimiento_id CHAR(36) NOT NULL, documento_id CHAR(36) NOT NULL,
 lineamiento VARCHAR(191) COLLATE utf8mb4_bin NOT NULL, activa BOOLEAN NOT NULL DEFAULT TRUE,
 UNIQUE(requerimiento_id, lineamiento), FOREIGN KEY (requerimiento_id) REFERENCES requerimientos(id),
 FOREIGN KEY (documento_id) REFERENCES documentos(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS versiones_motor (
 id CHAR(36) PRIMARY KEY, sha256 CHAR(64) NOT NULL UNIQUE, contenido JSON NOT NULL,
 created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS ejecuciones (
 id CHAR(36) PRIMARY KEY, estado VARCHAR(24) NOT NULL DEFAULT 'queued', configuracion JSON NOT NULL,
 motor_id CHAR(36) NOT NULL, snapshot JSON NOT NULL, error TEXT,
 created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3), finished_at TIMESTAMP(3) NULL,
 FOREIGN KEY (motor_id) REFERENCES versiones_motor(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS entradas_ejecucion (
 ejecucion_id CHAR(36) NOT NULL, requerimiento_id CHAR(36) NOT NULL, orden INT NOT NULL,
 version_requerimiento_id CHAR(36) NOT NULL, evidencia JSON NOT NULL,
 PRIMARY KEY(ejecucion_id, requerimiento_id), FOREIGN KEY (ejecucion_id) REFERENCES ejecuciones(id),
 FOREIGN KEY (version_requerimiento_id) REFERENCES versiones_requerimiento(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS tareas_procesamiento (
 id CHAR(36) PRIMARY KEY, ejecucion_id CHAR(36), tipo VARCHAR(24) NOT NULL, payload JSON NOT NULL,
 estado VARCHAR(24) NOT NULL DEFAULT 'queued', prioridad INT NOT NULL DEFAULT 10, intentos INT NOT NULL DEFAULT 0,
 lease_owner CHAR(36), lease_until TIMESTAMP(3) NULL, error TEXT,
 created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3), finished_at TIMESTAMP(3) NULL,
 INDEX cola(estado, prioridad, created_at), FOREIGN KEY (ejecucion_id) REFERENCES ejecuciones(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS llamadas_llm (
 id CHAR(36) PRIMARY KEY, tarea_id CHAR(36) NOT NULL, etapa VARCHAR(24) NOT NULL, modelo VARCHAR(128) NOT NULL,
 mensajes JSON NOT NULL, respuesta LONGTEXT, uso JSON, error TEXT, duracion_ms BIGINT,
 created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3), FOREIGN KEY (tarea_id) REFERENCES tareas_procesamiento(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS resultados_criterio (
 id CHAR(36) PRIMARY KEY, ejecucion_id CHAR(36) NOT NULL, requerimiento_id CHAR(36) NOT NULL,
 criterio_id INT NOT NULL, nombre VARCHAR(64) NOT NULL, estado_tecnico VARCHAR(24) NOT NULL,
 filas JSON NOT NULL, UNIQUE(ejecucion_id, requerimiento_id, criterio_id),
 FOREIGN KEY (ejecucion_id) REFERENCES ejecuciones(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS evaluaciones_consideracion (
 resultado_id CHAR(36) NOT NULL, orden INT NOT NULL, consideracion LONGTEXT NOT NULL,
 lineamiento TEXT, cumple VARCHAR(24), observacion LONGTEXT, literal LONGTEXT,
 PRIMARY KEY(resultado_id, orden), FOREIGN KEY(resultado_id) REFERENCES resultados_criterio(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS hallazgos (
 resultado_id CHAR(36) NOT NULL, orden INT NOT NULL, contenido JSON NOT NULL,
 PRIMARY KEY(resultado_id, orden), FOREIGN KEY(resultado_id) REFERENCES resultados_criterio(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS reportes (
 id CHAR(36) PRIMARY KEY, ejecucion_id CHAR(36) NOT NULL, tipo VARCHAR(24) NOT NULL,
 nombre VARCHAR(255) NOT NULL, archivo_path TEXT NOT NULL, sha256 CHAR(64) NOT NULL,
 UNIQUE(ejecucion_id, nombre), FOREIGN KEY(ejecucion_id) REFERENCES ejecuciones(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
