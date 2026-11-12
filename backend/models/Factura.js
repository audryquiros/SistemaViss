module.exports = (sequelize, DataTypes) => {
  const Factura = sequelize.define('Factura', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    numero_factura: { type: DataTypes.STRING(100), allowNull: true },
    fecha_emision: { type: DataTypes.STRING(50), allowNull: true },
    moneda: { type: DataTypes.STRING(10), allowNull: true },
    emisor_nombre: { type: DataTypes.STRING(255), allowNull: true },
    emisor_nif_rfc: { type: DataTypes.STRING(100), allowNull: true },
    emisor_direccion: { type: DataTypes.TEXT, allowNull: true },
    receptor_nombre: { type: DataTypes.STRING(255), allowNull: true },
    receptor_nif_rfc: { type: DataTypes.STRING(100), allowNull: true },
    subtotal: { type: DataTypes.DECIMAL(15, 2), allowNull: true },
    impuestos: { type: DataTypes.DECIMAL(15, 2), allowNull: true },
    total: { type: DataTypes.DECIMAL(15, 2), allowNull: true },
    raw_json: { type: DataTypes.JSON, allowNull: true },
    nivel_detalle: { type: DataTypes.STRING(10), allowNull: true },
    fingerprint: { type: DataTypes.STRING(64), allowNull: true, unique: true },
  }, {
    tableName: 'facturas',
    timestamps: true,
  });

  Factura.associate = (models) => {
    Factura.hasMany(models.FacturaItem, {
      foreignKey: 'facturaId',
      as: 'items',
      onDelete: 'CASCADE',
    });
  };

  return Factura;
};
