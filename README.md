```markdown
# 🍕 AfterPanch Backend — API de Delivery para Pizzería

> API REST robusta y escalable para la gestión completa de un sistema de delivery de pizzería. Construida con **NestJS**, **Prisma ORM** y **PostgreSQL**. Maneja pedidos en tiempo real, productos con variantes de tamaño, sistema de toppings por grupos, control de stock con insumos, cálculo de envío por zonas, motor de ofertas y notificaciones en vivo vía WebSocket.

---

## 🚀 Tecnologías

| Stack | Herramienta |
|-------|-------------|
| **Framework** | [NestJS](https://nestjs.com/) (TypeScript) |
| **ORM** | [Prisma](https://www.prisma.io/) 6 |
| **Base de datos** | [PostgreSQL](https://www.postgresql.org/) |
| **Real-time** | WebSocket (Gateway) |
| **Validación** | class-validator, class-transformer |
| **Autenticación** | JWT (Bearer tokens) |
| **Generador de tickets** | Integración con impresora térmica |

---

## ✨ Características

### 📦 Gestión de Productos
- **Variantes de tamaño**: Chica, Mediana, Grande, Familiar — cada una con precio independiente (fijo o multiplicador)
- **Tipos de masa**: Fina, gruesa, borde de queso, sin TACC — con costo adicional configurable
- **Recetas dinámicas (Escandallo)**: Vinculación de productos con insumos para descuento automático de stock al confirmar pedido
- **Categorías**: Organización del menú (Clásicas, Especiales, Vegetarianas, Empanadas, Bebidas, Postres) con orden personalizado
- **Código único**: Cada producto puede tener un código interno para referencia en cocina
- **Imágenes**: URL de imagen por producto para visualización en el menú

### 🧀 Sistema de Toppings
- **Grupos de toppings**: Quesos, Carnes, Vegetales, Premium — cada grupo con reglas independientes de selección
- **Toppings incluidos**: Configuración de cuántos toppings del grupo vienen en el precio base (ej: "hasta 3 quesos incluidos")
- **Toppings premium**: Marcados como `esPremium`, se cobran siempre independientemente del límite de incluidos
- **Precio por categoría**: Un mismo topping puede tener precio distinto según la categoría de pizza (ej: bacon cuesta más en especial que en clásica)
- **Stock por insumo**: Vinculación opcional a materias primas — al usarse un topping se descuenta del insumo asociado
- **Consumo configurable**: Cantidad de insumo que se consume por topping según el tamaño de pizza (ej: 50g de bacon para chica, 80g para grande)
- **Visibilidad**: Global (aparece en todas las pizzas) o filtrado por categorías específicas

### 🛒 Pedidos
- **Tipos de pedido**: `LOCAL` (comer en el local), `DELIVERY` (envío a domicilio), `RETIRO` (paso a buscar)
- **Estados del flujo**: `PENDIENTE` → `EN_PREPARACION` → `LISTO_PARA_RETIRAR` / `EN_CAMINO` → `ENTREGADO` / `CANCELADO`
- **Estados especiales**: `PROBLEMA_DIRECCION` para delivery con inconvenientes
- **Transiciones validadas**: No se puede saltar estados inválidos según el tipo de pedido
- **WebSocket en vivo**: Notificaciones instantáneas a cocina/dashboard cuando entra un nuevo pedido
- **Media y media**: Soporte para pizzas con dos sabores distintos (modelo `PizzaMediaMedia`)
- **Notas por línea**: Aclaraciones por producto ("sin aceitunas", "bien cocida", "sin salsa")
- **Datos del cliente**: Nombre, apellido, teléfono — capturados según el tipo de pedido
- **Método de pago**: Efectivo, Transferencia, Tarjeta

### 📍 Envíos y Zonas de Entrega
- **Barrios**: Cada barrio tiene su costo de envío configurado individualmente
- **Zonas por polígono**: Definición de zonas de envío con GeoJSON (`ShippingZone`)
- **Radio de entrega**: Configuración de radio máximo desde el local con precio base (`ShippingConfig`)
- **Tiers por distancia**: Precio escalonado según kilómetros (`ShippingRadiusTier`: 0-3km, 3-5km, 5-8km, etc.)
- **Geocoding**: Caché de direcciones con Nominatim (OpenStreetMap) — modelo `GeocodingCache`
- **Cálculo inteligente**: Determina si la dirección está dentro de una zona, dentro del radio, o fuera de rango
- **Tolerancia de borde**: Margen de metros para direcciones cerca del límite de zona

### 🎯 Sistema de Ofertas
- **2x1**: Dos productos por el precio de uno
- **Combos**: Grupos de productos donde se elige X de cada grupo con precio especial
- **Descuento porcentaje**: X% de descuento en productos seleccionados
- **Descuento fijo**: $X de descuento directo sobre el total
- **Restricciones configurables**:
  - Días de la semana aplicables
  - Horario de inicio y fin
  - Usos máximos por cliente
  - Usos máximos totales
  - Estado: Activa, Pausada, Vencida
- **Cálculo automático**: El motor de ofertas (`OfertasCalculatorService`) calcula el mejor descuento al crear el pedido
- **Aplicación por línea o por pedido**: Configuración flexible

### 📊 Control de Stock
- **Insumos**: Materias primas con stock actual, stock mínimo, unidad de medida (gr, ml, un, feta, sobre)
- **Movimientos de stock**: Historial completo con tipo (`DESCUENTO_PEDIDO`, `AJUSTE_MANUAL`, `REPOSICION`), cantidad, stock antes/después, motivo
- **Descuento automático**: Al crear un pedido se descuenta según la receta del producto + toppings seleccionados
- **Reintegro por cancelación**: Al cancelar un pedido se restaura el stock de insumos, toppings y aderezos
- **Validación previa**: Antes de crear el pedido se verifica que haya stock suficiente — si no, rechaza con mensaje claro
- **Proveedores**: Vinculación de insumos con proveedores (nombre, teléfono, email, notas)
- **Alertas**: Stock mínimo configurable por insumo

### 👥 Roles y Permisos
| Rol | Descripción |
|-----|-------------|
| **ADMIN** | Acceso total: configuración, stock, productos, ofertas, usuarios, caja |
| **TRABAJADOR** | Gestión de pedidos, atención en local, cocina, consulta de precios |
| **DELIVERY** | Solo ve pedidos asignados para repartir, puede cambiar estado a "Entregado" |
| **CLIENTE** | Acceso al menú público y estado de sus pedidos |

### 💰 Caja y Finanzas
- **Movimientos de caja**: Registro de entradas y salidas vinculadas a pedidos
- **Ganancia del negocio**: Cálculo automático basado en costo de insumos vs precio de venta
- **Ganancia del repartidor**: Porcentaje o monto fijo por delivery
- **Confirmación**: Los movimientos pueden requerir confirmación de un admin

### ⚙️ Configuración del Negocio
- **Horarios**: Hora de apertura y cierre — el sistema rechaza pedidos fuera de horario
- **Alias de transferencia**: Para mostrar en el checkout al cliente
- **WhatsApp**: Número para contacto y envío de comprobantes
- **Datos del local**: Nombre, dirección, coordenadas GPS para cálculo de envío

---

## 📁 Estructura del Proyecto

```
afterpanch-backend/
├── prisma/
│   ├── schema.prisma              # Modelos completos de base de datos
│   └── migrations/                # Historial de migraciones aplicadas
├── src/
│   ├── auth/                      # Autenticación JWT, guards, estrategias
│   ├── pedidos/                   # CRUD de pedidos, validaciones, gateway WebSocket
│   ├── pedidos/pedidos.service.ts # Lógica de cobro, stock, ofertas
│   ├── productos/                 # CRUD de productos, categorías, variantes
│   ├── extras/                    # Sistema de toppings/extras con grupos
│   ├── insumos/                   # Control de stock, proveedores, movimientos
│   ├── ofertas/                   # Motor de ofertas y descuentos
│   ├── ofertas/ofertas-calculator.service.ts # Cálculo automático de descuentos
│   ├── shipping/                  # Zonas de envío, geocoding, cálculo de precio
│   ├── config/                    # Configuración del negocio (horarios, alias, etc.)
│   ├── caja/                      # Movimientos de caja y finanzas
│   ├── usuarios/                  # Gestión de usuarios y roles
│   ├── aderezos/                  # Salsas para mojar (gratuitas con límite)
│   ├── barrios/                   # CRUD de barrios con precio de envío
│   ├── main.ts                    # Entry point de la aplicación
│   └── app.module.ts              # Módulo raíz
├── .env.example                   # Variables de entorno de ejemplo
├── nest-cli.json                  # Configuración de NestJS CLI
├── tsconfig.json                  # Configuración de TypeScript
└── package.json
```

---

## 🗃️ Modelos de Base de Datos

```
User                    → Usuarios del sistema (admin, trabajador, delivery, cliente)
Producto                → Productos del menú (pizzas, empanadas, bebidas, etc.)
ProductoVariante        → Tamaños: Chica, Mediana, Grande, Familiar
ProductoReceta          → Receta/escandallo: vincula producto con insumos y cantidades
Categoria               → Categorías del menú con orden y descripción
ToppingGrupo            → Grupos de toppings (Quesos, Carnes, Vegetales, Premium)
Topping                 → Toppings individuales con precio, stock, grupo
ToppingPrecio           → Precio de topping por categoría de producto
ToppingConsumo          → Cantidad de insumo consumido por topping según categoría
ToppingCategoria        → Categorías de producto donde aplica cada topping
Aderezo                 → Salsas para mojar (marinara, garlic, ranch, etc.)
AderezoPrecio           → Precio de aderezo por categoría
AderezoConsumo          → Consumo de aderezo por categoría
AderezoCategoria        → Categorías donde aplica cada aderezo
Insumo                  → Materias primas con stock y proveedor
Proveedor               → Proveedores de insumos
StockMovimiento         → Historial de movimientos de stock
Pedido                  → Pedidos con tipo, estado, datos del cliente, dirección
PedidoDetalle           → Líneas del pedido con producto, cantidad, toppings, notas
PedidoOferta            → Ofertas aplicadas a cada pedido
TipoMasa                → Tipos de masa disponibles (fina, gruesa, borde de queso)
PizzaMediaMedia         → Pizzas con dos sabores distintos
Oferta                  → Ofertas activas con tipo, restricciones, vigencia
OfertaProducto          → Productos vinculados a una oferta
GrupoCombo              → Grupos de selección dentro de un combo
GrupoOpcion             → Opciones disponibles en cada grupo de combo
ShippingConfig          → Configuración general de envío (radio, modo, precio)
ShippingZone            → Zonas de envío con polígono GeoJSON
ShippingRadiusTier      → Tiers de precio por distancia
Barrio                  → Barrios con precio de envío
GeocodingCache          → Caché de geocoding de direcciones
CajaMovimiento          → Movimientos de entrada/salida de caja
Configuracion           → Clave-valor para configuración del negocio
```

---

## 🛠️ Instalación y Ejecución

```bash
# Clonar el repositorio
git clone <repo-url>
cd afterpanch-backend

# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env
# Editar DATABASE_URL con tu conexión PostgreSQL
# Ejemplo: DATABASE_URL=postgresql://user:password@localhost:5432/afterpanch

# Generar cliente de Prisma
npx prisma generate

# Aplicar migraciones a la base de datos
npx prisma migrate dev

# (Opcional) Abrir Prisma Studio para ver los datos
npx prisma studio

# Levantar en modo desarrollo (con hot-reload)
npm run start:dev

# Levantar en modo debug
npm run start:debug

# Build para producción
npm run build

# Ejecutar en producción
npm run start:prod
```

---

## 🔌 Endpoints Principales

### Pedidos
| Método | Endpoint | Auth | Descripción |
|--------|----------|------|-------------|
| `GET` | `/pedidos` | ADMIN, TRABAJADOR | Listar todos los pedidos |
| `GET` | `/pedidos/delivery` | ADMIN, TRABAJADOR, DELIVERY | Pedidos de delivery pendientes |
| `GET` | `/pedidos/:id` | ADMIN, TRABAJADOR | Detalle de un pedido |
| `POST` | `/pedidos` | Público | Crear un nuevo pedido |
| `PATCH` | `/pedidos/:id/estado` | ADMIN, TRABAJADOR | Cambiar estado del pedido |
| `PATCH` | `/pedidos/:id/pago` | ADMIN, TRABAJADOR | Registrar método de pago |
| `PATCH` | `/pedidos/:id/cancelar` | ADMIN, TRABAJADOR | Cancelar pedido con motivo |
| `PATCH` | `/pedidos/:id/finalizar` | ADMIN, TRABAJADOR | Marcar como entregado |
| `PATCH` | `/pedidos/:id/envio` | ADMIN | Actualizar costo de envío |
| `PATCH` | `/pedidos/:id/repartidor` | ADMIN | Asignar/desasignar repartidor |

### Productos
| Método | Endpoint | Auth | Descripción |
|--------|----------|------|-------------|
| `GET` | `/productos` | Público | Listar productos activos |
| `GET` | `/productos/:id` | ADMIN | Detalle de un producto |
| `POST` | `/productos` | ADMIN | Crear producto |
| `PATCH` | `/productos/:id` | ADMIN | Actualizar producto |
| `DELETE` | `/productos/:id` | ADMIN | Eliminar producto |

### Toppings
| Método | Endpoint | Auth | Descripción |
|--------|----------|------|-------------|
| `GET` | `/toppings` | Público | Listar toppings |
| `GET` | `/toppings/por-categoria/:id` | Público | Toppings disponibles para una categoría |
| `GET` | `/toppings/:id` | ADMIN | Detalle de un topping |
| `POST` | `/toppings` | ADMIN | Crear topping |
| `PATCH` | `/toppings/:id` | ADMIN | Actualizar topping |
| `DELETE` | `/toppings/:id` | ADMIN | Eliminar topping |
| `PATCH` | `/toppings/:id/stock` | ADMIN | Ajustar stock |
| `POST` | `/toppings/precio-categoria` | ADMIN | Setear precio por categoría |
| `POST` | `/toppings/consumo-categoria` | ADMIN | Setear consumo por categoría |

### Insumos
| Método | Endpoint | Auth | Descripción |
|--------|----------|------|-------------|
| `GET` | `/insumos` | ADMIN | Listar insumos |
| `POST` | `/insumos` | ADMIN | Crear insumo |
| `PATCH` | `/insumos/:id` | ADMIN | Actualizar insumo |
| `DELETE` | `/insumos/:id` | ADMIN | Eliminar insumo |
| `PATCH` | `/insumos/:id/stock` | ADMIN | Agregar/reponer stock |
| `GET` | `/insumos/:id/movimientos` | ADMIN | Historial de movimientos |

### Ofertas
| Método | Endpoint | Auth | Descripción |
|--------|----------|------|-------------|
| `GET` | `/ofertas` | Público | Listar ofertas activas |
| `POST` | `/ofertas` | ADMIN | Crear oferta |
| `PATCH` | `/ofertas/:id` | ADMIN | Actualizar oferta |
| `DELETE` | `/ofertas/:id` | ADMIN | Eliminar oferta |
| `POST` | `/ofertas/calcular` | Público | Calcular descuento para un carrito |

### Shipping
| Método | Endpoint | Auth | Descripción |
|--------|----------|------|-------------|
| `GET` | `/shipping/config` | Público | Obtener configuración de envío |
| `PATCH` | `/shipping/config` | ADMIN | Actualizar configuración |
| `GET` | `/shipping/zones` | Público | Listar zonas activas |
| `POST` | `/shipping/zones` | ADMIN | Crear zona |
| `PATCH` | `/shipping/zones/:id` | ADMIN | Actualizar zona |
| `DELETE` | `/shipping/zones/:id` | ADMIN | Eliminar zona |
| `POST` | `/shipping/calculate` | Público | Calcular costo de envío por dirección |
| `GET` | `/shipping/tiers` | Público | Listar tiers de distancia |

### Barrios
| Método | Endpoint | Auth | Descripción |
|--------|----------|------|-------------|
| `GET` | `/barrios` | Público | Listar barrios activos |
| `POST` | `/barrios` | ADMIN | Crear barrio |
| `PATCH` | `/barrios/:id` | ADMIN | Actualizar barrio |
| `DELETE` | `/barrios/:id` | ADMIN | Eliminar barrio |

### Categorías
| Método | Endpoint | Auth | Descripción |
|--------|----------|------|-------------|
| `GET` | `/categorias` | Público | Listar categorías activas |
| `POST` | `/categorias` | ADMIN | Crear categoría |
| `PATCH` | `/categorias/:id` | ADMIN | Actualizar categoría |
| `DELETE` | `/categorias/:id` | ADMIN | Eliminar categoría |

### Configuración
| Método | Endpoint | Auth | Descripción |
|--------|----------|------|-------------|
| `GET` | `/config` | Público | Obtener todas las configuraciones |
| `POST` | `/config` | ADMIN | Crear/actualizar configuración |

### Caja
| Método | Endpoint | Auth | Descripción |
|--------|----------|------|-------------|
| `GET` | `/caja/movimientos` | ADMIN | Listar movimientos de caja |
| `GET` | `/caja/resumen` | ADMIN | Resumen de caja (entradas, salidas, balance) |

---

## 🔑 Variables de Entorno

```env
# Base de datos
DATABASE_URL=postgresql://user:password@localhost:5432/afterpanch

# Puerto del servidor
PORT=3001

# JWT
JWT_SECRET=tu_secreto_super_seguro
JWT_EXPIRES_IN=7d

# Geocoding (Nominatim)
GEOCODING_USER_AGENT=AfterPanch/1.0
```

---

## 📊 Diagrama de Flujo de Pedido

```
Cliente crea pedido (POST /pedidos)
    │
    ├── Validar horario de apertura
    ├── Validar productos activos
    ├── Validar stock de insumos (receta + toppings)
    ├── Calcular ofertas aplicables
    ├── Calcular total (productos + toppings - descuentos + envío)
    │
    ├── Crear pedido en BD (transacción)
    │   ├── Crear PedidoDetalle por línea
    │   ├── Descontar stock de insumos
    │   ├── Descontar stock de toppings
    │   ├── Registrar movimientos de stock
    │   └── Registrar ofertas aplicadas
    │
    └── Emitir evento WebSocket → Notificar a cocina
        └── { id, nombreCliente, tipo, total }
```

---

## 🔄 Estados del Pedido

```
PENDIENTE
    ├──→ EN_PREPARACION
    │       ├──→ LISTO_PARA_RETIRAR  (LOCAL / RETIRO)
    │       │       └──→ ENTREGADO
    │       │
    │       └──→ EN_CAMINO           (DELIVERY)
    │               ├──→ ENTREGADO
    │               └──→ PROBLEMA_DIRECCION
    │                       └──→ EN_CAMINO (reintento)
    │
    └──→ CANCELADO (desde cualquier estado abierto)
```

---

## 📝 Licencia

[MIT](LICENSE)
```
