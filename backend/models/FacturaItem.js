module.exports = (sequelize, DataTypes) => {
  const FacturaItem = sequelize.define('FacturaItem', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    facturaId: { type: DataTypes.INTEGER, allowNull: false },
    descripcion: { type: DataTypes.STRING(500), allowNull: true },
    cantidad: { type: DataTypes.DECIMAL(15, 3), allowNull: true },
    precio_unitario: { type: DataTypes.DECIMAL(15, 2), allowNull: true },
    importe: { type: DataTypes.DECIMAL(15, 2), allowNull: true },
  }, {
    tableName: 'factura_items',
    timestamps: false,
  });

  FacturaItem.associate = (models) => {
    FacturaItem.belongsTo(models.Factura, {
      foreignKey: 'facturaId',
      as: 'factura',
    });
  };

  return FacturaItem;
};
