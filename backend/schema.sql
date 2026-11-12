-- =====================================================
-- SISTEMA VISION
-- Schema MySQL
-- =====================================================

CREATE DATABASE IF NOT EXISTS sistemavision
CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;

USE sistemavision;

-- =====================================================
-- Tabla: facturas
-- =====================================================

CREATE TABLE IF NOT EXISTS facturas (
    id INT NOT NULL AUTO_INCREMENT,

    numero_factura VARCHAR(100) NULL,
    fecha_emision VARCHAR(50) NULL,
    moneda VARCHAR(10) NULL,

    emisor_nombre VARCHAR(255) NULL,
    emisor_nif_rfc VARCHAR(100) NULL,
    emisor_direccion TEXT NULL,

    receptor_nombre VARCHAR(255) NULL,
    receptor_nif_rfc VARCHAR(100) NULL,

    subtotal DECIMAL(15,2) NULL,
    impuestos DECIMAL(15,2) NULL,
    total DECIMAL(15,2) NULL,

    raw_json JSON NULL,

    nivel_detalle VARCHAR(10) NULL,

    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id)
);

-- =====================================================
-- Tabla: factura_items
-- =====================================================

CREATE TABLE IF NOT EXISTS factura_items (
    id INT NOT NULL AUTO_INCREMENT,

    facturaId INT NOT NULL,

    descripcion VARCHAR(500) NULL,
    cantidad DECIMAL(15,3) NULL,
    precio_unitario DECIMAL(15,2) NULL,
    importe DECIMAL(15,2) NULL,

    PRIMARY KEY (id),

    CONSTRAINT fk_factura_items_factura
        FOREIGN KEY (facturaId)
        REFERENCES facturas(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

-- =====================================================
-- Índices
-- =====================================================

CREATE INDEX idx_facturas_numero
    ON facturas(numero_factura);

CREATE INDEX idx_facturas_fecha
    ON facturas(fecha_emision);

CREATE INDEX idx_factura_items_factura
    ON factura_items(facturaId);

-- =====================================================
-- Verificación
-- =====================================================

SHOW TABLES;

DESCRIBE facturas;

DESCRIBE factura_items;