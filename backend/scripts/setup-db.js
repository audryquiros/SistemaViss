'use strict';

require('dotenv').config();
const { Sequelize } = require('sequelize');

const database = process.env.DB_NAME || 'sistemavision';
const username = process.env.DB_USER || 'root';
const password = process.env.DB_PASSWORD || '';
const host = process.env.DB_HOST || '127.0.0.1';
const port = Number(process.env.DB_PORT || 3306);

async function main() {
  let server;
  let db;

  try {
    console.log('🔄 Conectando a MySQL...');

    server = new Sequelize('', username, password, {
      host,
      port,
      dialect: 'mysql',
      logging: false,
    });

    await server.authenticate();
    await server.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
    await server.close();
    server = null;

    db = new Sequelize(database, username, password, {
      host,
      port,
      dialect: 'mysql',
      logging: false,
    });

    await db.authenticate();
    await db.query(`
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
        updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Migración para instalaciones existentes: agrega fingerprint si la tabla ya existía.
    const [fingerprintColumn] = await db.query(`
      SELECT COUNT(*) AS total
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = 'facturas'
        AND COLUMN_NAME = 'fingerprint'
    `, { replacements: [database] });

    if (Number(fingerprintColumn[0].total) === 0) {
      console.log('🔄 Agregando columna fingerprint a facturas...');
      await db.query(`
        ALTER TABLE facturas
        ADD COLUMN fingerprint VARCHAR(64) NULL
      `);
    }

    const [fingerprintIndex] = await db.query(`
      SELECT COUNT(*) AS total
      FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = 'facturas'
        AND INDEX_NAME = 'uq_facturas_fingerprint'
    `, { replacements: [database] });

    if (Number(fingerprintIndex[0].total) === 0) {
      console.log('🔄 Creando índice único para evitar facturas duplicadas...');
      await db.query(`
        ALTER TABLE facturas
        ADD UNIQUE KEY uq_facturas_fingerprint (fingerprint)
      `);
    }

    await db.query(`
      CREATE TABLE IF NOT EXISTS factura_items (
        id INT NOT NULL AUTO_INCREMENT,
        facturaId INT NOT NULL,
        descripcion VARCHAR(500) NULL,
        cantidad DECIMAL(15,3) NULL,
        precio_unitario DECIMAL(15,2) NULL,
        importe DECIMAL(15,2) NULL,
        PRIMARY KEY (id),
        INDEX idx_factura_items_factura (facturaId),
        CONSTRAINT fk_factura_items_factura
          FOREIGN KEY (facturaId) REFERENCES facturas(id)
          ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    console.log('✅ Base de datos creada/verificada:', database);
    console.log('✅ Tabla facturas creada/verificada.');
    console.log('✅ Tabla factura_items creada/verificada.');
    console.log('🎉 Configuración de base de datos completada.');
  } catch (error) {
    console.error('❌ Error al configurar la base de datos:', error.message);
    process.exitCode = 1;
  } finally {
    if (server) await server.close().catch(() => {});
    if (db) await db.close().catch(() => {});
  }
}

main();
