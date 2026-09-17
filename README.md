# ECO HOGAR: Dashboard de Gestión Financiera Familiar

![Status](https://img.shields.io/badge/Status-Producción-brightgreen)
![Arquitectura](https://img.shields.io/badge/Arquitectura-SaaS%20Ready-blue)
![Deploy](https://img.shields.io/badge/Deploy-Vercel-black)

**Desarrollador:** Leonardo Carlos Narciso
**Tipo de Aplicación:** Plataforma Web / Dashboard Financiero

🔗 **[Visitar Dashboard en Producción](https://mi-economia-hogar-lilac.vercel.app/dashboard)**

## Resumen del Proyecto
ECO HOGAR es una aplicación web de gestión económica diseñada para centralizar, organizar y analizar la salud financiera de un hogar. A diferencia de un simple registro de gastos, la plataforma procesa movimientos dispersos (bancos, efectivo, billeteras virtuales, tarjetas) y los transforma en métricas claras para la toma de decisiones. 

El objetivo es permitir que los usuarios pasen de una economía familiar reactiva (saber en qué se gastó) a una planificada (proyectar y decidir sobre datos históricos y compromisos futuros).

## Arquitectura Técnica y Stack
El proyecto está construido sobre un stack moderno, preparado para evolucionar hacia un modelo comercial SaaS (Software as a Service) multi-tenant:

*   **Frontend & Framework:** Next.js (React + TypeScript) para la interfaz de usuario, componentes y ruteo.
*   **Backend & Base de Datos:** Supabase (PostgreSQL) para almacenamiento relacional seguro.
*   **Autenticación:** Supabase Auth (gestión de sesiones y usuarios).
*   **Almacenamiento de Archivos:** Supabase Storage para tickets y comprobantes asociados a movimientos.
*   **Hosting y Despliegue:** Vercel (Edge network, HTTPS, CI/CD).

## ⚙️ Funcionalidades Core
*   **Gestión Estructurada:** Registro de ingresos y gastos categorizados y asignados a responsables específicos del hogar.
*   **Gestión Multi-cuenta:** Soporte para efectivo, tarjetas de crédito, billeteras digitales (Mercado Pago) y cuentas bancarias.
*   **Importación Masiva:** Módulo de ingesta de datos vía archivos CSV (ideal para extractos bancarios) con validación previa a la inserción en base de datos.
*   **Gestión Documental:** Capacidad de adjuntar y almacenar evidencia física/digital (tickets, facturas) a cada movimiento financiero.
*   **Visualización de Datos:** Dashboards analíticos para comparar consumos mensuales y detectar tendencias de ahorro o gasto.

## Seguridad y Escalabilidad (Roadmap SaaS)
El desarrollo actual sienta las bases para un producto comercial, con foco en:
*   **Row Level Security (RLS):** Implementación de políticas nativas en PostgreSQL para aislar los datos financieros (multi-tenancy mediante `household_id`), asegurando que cada usuario acceda únicamente a su información.
*   **Privacidad:** Diseño orientado a la protección de datos sensibles, manteniendo credenciales (service roles, tokens) exclusivamente en el entorno del servidor y utilizando buckets de almacenamiento privado.
*   **Orquestación de Pagos:** Arquitectura preparada para futuras integraciones de cobro recurrente (Suscripciones vía Mercado Pago / Webhooks).

## Impacto y Casos de Uso
La plataforma resuelve el problema de la fragmentación de la información financiera, permitiendo responder preguntas clave del negocio familiar:
*   *¿Cuál es el porcentaje de gasto variable mensual?*
*   *¿Cuál es la proyección de saldo a fin de mes considerando tarjetas e ingresos pendientes?*
*   *¿Cómo es la evolución del ahorro y el consumo categorizado interanualmente?*
