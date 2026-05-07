# 🍕 AfterPanch Backend

<div align="center">

API REST moderna y escalable para un sistema completo de delivery de pizzería.
Construida con **NestJS**, **Prisma ORM** y **PostgreSQL**.

Maneja pedidos en tiempo real, stock inteligente, toppings dinámicos, cálculo de envío por zonas y ofertas automáticas.

</div>

---

## 🚀 Stack Tecnológico

<div align="center">

| Tecnología                      | Uso                                |
| ------------------------------- | ---------------------------------- |
| **NestJS**                      | Framework Backend                  |
| **TypeScript**                  | Lenguaje principal                 |
| **Prisma ORM**                  | Acceso y modelado de base de datos |
| **PostgreSQL**                  | Base de datos relacional           |
| **WebSocket Gateway**           | Eventos en tiempo real             |
| **JWT Auth**                    | Autenticación                      |
| **class-validator**             | Validaciones DTO                   |
| **Thermal Printer Integration** | Tickets e impresión                |

</div>

---

# ✨ Funcionalidades

---

## 📦 Gestión de Productos

Sistema flexible para manejar productos complejos de delivery.

### Incluye

* Variantes de tamaño:

  * Chica
  * Mediana
  * Grande
  * Familiar

* Tipos de masa:

  * Fina
  * Gruesa
  * Borde relleno
  * Sin TACC

* Categorías personalizadas

* Código interno de cocina

* Imagen por producto

* Recetas dinámicas (escandallo)

* Descuento automático de insumos

### Ejemplo

```txt
Pizza Especial
 ├── Grande → $14.000
 ├── Familiar → $18.500
 └── Masa borde queso → +$2.000
```

---

## 🧀 Sistema de Toppings

Sistema avanzado de toppings por grupos y reglas dinámicas.

### Características

* Grupos independientes:

  * Quesos
  * Carnes
  * Vegetales
  * Premium

* Límite de toppings incluidos

* Toppings premium siempre cobrados

* Precios variables según categoría

* Consumo configurable por tamaño

* Integración con stock de insumos

* Visibilidad global o filtrada

### Ejemplo

```txt
Pizza Clásica
 ├── Hasta 3 quesos incluidos
 ├── Bacon → Premium (+$1500)
 └── Extra mozzarella → +80gr stock
```

---

## 🛒 Gestión de Pedidos

Flujo completo de pedidos en tiempo real.

### Tipos

* 🏠 DELIVERY
* 🍽️ LOCAL
* 🛍️ RETIRO

### Estados

```txt
PENDIENTE
   ↓
EN_PREPARACION
   ↓
LISTO_PARA_RETIRAR / EN_CAMINO
   ↓
ENTREGADO
```

### Funciones

* Validación de transiciones
* WebSocket en vivo
* Media y media
* Notas por línea
* Métodos de pago
* Datos de cliente
* Problemas de dirección

---

## 📍 Sistema de Envíos

Motor inteligente de cálculo de delivery.

### Soporta

* Barrios con precio fijo
* Zonas mediante polígonos GeoJSON
* Radio máximo configurable
* Precio por distancia
* Geocoding con OpenStreetMap
* Caché de direcciones
* Tolerancia de bordes

### Ejemplo de tiers

```txt
0km - 3km  → $1200
3km - 5km  → $1800
5km - 8km  → $2500
```

---

## 🎯 Sistema de Ofertas

Motor de promociones configurable.

### Tipos disponibles

* 2x1
* Combos
* Descuento porcentual
* Descuento fijo

### Restricciones

* Días específicos
* Horarios
* Límite por cliente
* Límite total
* Estado activo/pausado/vencido

### Extras

* Mejor descuento automático
* Aplicación por línea o pedido completo

---

## 📊 Control de Stock

Control automático y trazable de insumos.

### Funcionalidades

* Insumos con stock mínimo
* Movimientos históricos
* Descuento automático
* Reintegro por cancelación
* Validación previa de stock
* Gestión de proveedores
* Alertas automáticas

### Tipos de movimiento

```txt
DESCUENTO_PEDIDO
AJUSTE_MANUAL
REPOSICION
```

---

## 👥 Roles y Permisos

<div align="center">

| Rol              | Acceso           |
| ---------------- | ---------------- |
| 👑 ADMIN         | Acceso completo  |
| 👨‍🍳 TRABAJADOR | Cocina y pedidos |
| 🛵 DELIVERY      | Repartos         |
| 🍕 CLIENTE       | Menú y pedidos   |

</div>

---

## 💰 Caja y Finanzas

### Incluye

* Movimientos de caja
* Entradas y salidas
* Ganancia del negocio
* Ganancia del repartidor
* Confirmaciones administrativas

---

## ⚙️ Configuración del Negocio

### Configurable desde panel admin

* Horarios de apertura/cierre
* Alias de transferencia
* WhatsApp del local
* Dirección y coordenadas
* Datos generales del negocio

---

# 📡 Tiempo Real

El sistema utiliza WebSockets para actualizar automáticamente:

* Nuevos pedidos
* Cambios de estado
* Dashboard de cocina
* Pedidos asignados a delivery
* Notificaciones administrativas

---

# 🧠 Arquitectura

```txt
Client App
    ↓
REST API (NestJS)
    ↓
Services Layer
    ↓
Prisma ORM
    ↓
PostgreSQL
```

---

# 🔒 Seguridad

* JWT Authentication
* Roles & Guards
* DTO Validation
* Sanitización de inputs
* Validación de permisos
* Protección de rutas privadas

---

# 📁 Estructura del Proyecto

```txt
src/
├── auth/
├── users/
├── products/
├── toppings/
├── orders/
├── delivery/
├── offers/
├── stock/
├── finance/
├── websocket/
├── config/
├── prisma/
└── common/
```

---

# 🚀 Objetivo

AfterPanch Backend fue diseñado para ser:

* Escalable
* Modular
* Real-time
* Fácil de mantener
* Preparado para múltiples sucursales
* Optimizado para alto volumen de pedidos

---

<div align="center">

### 🍕 AfterPanch Backend

Sistema profesional de delivery desarrollado con arquitectura moderna.

</div>



```bash
afterpanch-backend/
├── prisma/
├── src/
│   ├── auth/
│   ├── pedidos/
│   ├── productos/
│   ├── extras/
│   ├── insumos/
│   ├── ofertas/
│   ├── shipping/
│   ├── config/
│   ├── caja/
│   ├── usuarios/
│   ├── aderezos/
│   ├── barrios/
│   ├── main.ts
│   └── app.module.ts
├── .env.example
├── nest-cli.json
├── tsconfig.json
└── package.json
```

---


# 🗃️ Modelos de Base de Datos

## 👥 Usuarios y Roles

| Modelo | Descripción |
|---|---|
| `User` | Usuarios del sistema (admin, trabajador, delivery, cliente) |

---

## 🍕 Productos y Menú

| Modelo | Descripción |
|---|---|
| `Producto` | Productos del menú |
| `ProductoVariante` | Tamaños: Chica, Mediana, Grande, Familiar |
| `Categoria` | Categorías del menú |
| `TipoMasa` | Tipos de masa disponibles |
| `PizzaMediaMedia` | Pizzas con dos sabores |

---

## 🧾 Recetas y Stock

| Modelo | Descripción |
|---|---|
| `ProductoReceta` | Escandallo de productos |
| `Insumo` | Materias primas |
| `Proveedor` | Proveedores |
| `StockMovimiento` | Historial de movimientos |

---

## 🧀 Toppings y Aderezos

| Modelo | Descripción |
|---|---|
| `ToppingGrupo` | Grupos de toppings |
| `Topping` | Toppings individuales |
| `ToppingPrecio` | Precio según categoría |
| `ToppingConsumo` | Consumo de insumos |
| `ToppingCategoria` | Categorías donde aplica |
| `Aderezo` | Salsas y extras |
| `AderezoPrecio` | Precio por categoría |
| `AderezoConsumo` | Consumo por categoría |
| `AderezoCategoria` | Categorías compatibles |

---

## 🛒 Pedidos

| Modelo | Descripción |
|---|---|
| `Pedido` | Pedido principal |
| `PedidoDetalle` | Líneas del pedido |
| `PedidoOferta` | Ofertas aplicadas |

---

## 🎯 Ofertas y Combos

| Modelo | Descripción |
|---|---|
| `Oferta` | Ofertas activas |
| `OfertaProducto` | Productos vinculados |
| `GrupoCombo` | Grupos de selección |
| `GrupoOpcion` | Opciones de combo |

---

## 📍 Delivery y Envíos

| Modelo | Descripción |
|---|---|
| `ShippingConfig` | Configuración general |
| `ShippingZone` | Zonas GeoJSON |
| `ShippingRadiusTier` | Tiers por distancia |
| `Barrio` | Barrios con costo fijo |
| `GeocodingCache` | Caché de direcciones |

---

## 💰 Caja y Configuración

| Modelo | Descripción |
|---|---|
| `CajaMovimiento` | Entradas y salidas |
| `Configuracion` | Configuración global |

---

# 🛠️ Instalación y Ejecución

## 1️⃣ Clonar repositorio

```bash
git clone <repo-url>
cd afterpanch-backend
```

---

## 2️⃣ Instalar dependencias

```bash
npm install
```

---

## 3️⃣ Configurar entorno

```bash
cp .env.example .env
```

Editar:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/afterpanch
```

---

## 4️⃣ Prisma

### Generar cliente

```bash
npx prisma generate
```

### Aplicar migraciones

```bash
npx prisma migrate dev
```

### Abrir Prisma Studio

```bash
npx prisma studio
```

---

## 5️⃣ Ejecutar proyecto

### Desarrollo

```bash
npm run start:dev
```

### Debug

```bash
npm run start:debug
```

### Build producción

```bash
npm run build
```

### Ejecutar producción

```bash
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
