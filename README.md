# Áurea

Billetera virtual de demostración y gestión de mobiliario en una misma aplicación. La aplicación usa un único inicio de sesión; no hay registro de cuentas. La billetera **no procesa pagos reales**: sus recargas generan saldo ficticio para probar transferencias entre cuentas locales.

La cuenta de acceso es Jeffrey Diddy (`jefreymenendez5@gmail.com`). La contraseña inicial se muestra al propietario del proyecto. Las cuentas de muestra se conservan para identificar a las personas en reservas, préstamos y transferencias.

## Ejecutar

Requiere Node.js 20 o superior. No necesita dependencias externas.

```bash
npm start
```

Abre `http://localhost:3000`. La primera ejecución crea `data/db.json` con 20 mesas y 100 sillas. Para ejecutar las pruebas de reglas de negocio:

```bash
npm test
```

## Recorrido

1. En **Resumen**, consulta totales, disponibilidad, reservas, préstamos y devoluciones pendientes.
2. En **Reservas**, crea una solicitud. El sistema retiene las cantidades y no permite superar el stock.
3. El administrador aprueba la solicitud y registra el préstamo desde el formulario; la transición conserva el mismo compromiso de inventario.
4. En **Préstamos**, registra una devolución parcial o completa. Cada retorno libera únicamente las cantidades recibidas.
5. En **Movimientos**, consulta quién hizo el cambio, las cantidades y los estados antes y después.

Desde **Billetera**, se puede añadir saldo ficticio (hasta 10 000 USD por operación) y transferirlo a otra cuenta de muestra. Cada envío verifica el saldo y actualiza ambas cuentas de forma atómica. El saldo se guarda y calcula en centavos; los movimientos se muestran en el historial.

Las páginas API requieren la cookie de sesión. La contraseña del usuario se almacena como hash scrypt y las sesiones duran siete días.

## API principal

- `GET /api/wallet`, `POST /api/wallet/deposits`, `POST /api/wallet/transfers`
- `GET /api/dashboard`, `GET /api/inventory`
- `GET|POST /api/reservations`, `PATCH /api/reservations/:id`
- `GET|POST /api/loans`, `POST /api/reservations/:id/loan`
- `POST /api/loans/:id/returns`
- `PATCH /api/inventory/:resourceId`
- `GET /api/history`, `GET /api/users`

La API opera como el perfil administrador de demostración después de iniciar sesión. Las escrituras se serializan y los cambios de saldo se persisten en un reemplazo atómico del archivo JSON. Los saldos de mobiliario se derivan de los registros operativos.

## Alcance de despliegue

El saldo añadido desde la interfaz es dinero ficticio, no un depósito ni un cobro. Para aceptar dinero real se debe integrar y configurar un proveedor de pagos; esta aplicación no solicita ni guarda datos de tarjetas.

El archivo JSON está pensado para desarrollo local con una sola instancia del servidor. Para producción, migrar a una base de datos transaccional e integrar un proveedor de pagos real si fuese necesario.

La arquitectura, el modelo de datos, el flujo de estados, las reglas y las rutas se describen en [ARCHITECTURE.md](ARCHITECTURE.md).