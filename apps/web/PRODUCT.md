# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Junta directiva voluntaria** (propietario, administrador, director, secretario, tesorero, responsable de material): gestiona la banda en su tiempo libre, sobre todo en ordenador. Tareas largas y densas: socios, tesorería, archivo, contrataciones, asambleas, escuela.
- **Músicos y colaboradores**: consultan en el móvil convocatorias, agenda, asistencia y refuerzos; responden rápido, a menudo de camino a un ensayo o actuación.
- **Familias y tutores** de la escuela de música: usan el portal de familias en el móvil (matrícula, horarios, notas, mensualidades).
- **Equipo de plataforma**: opera el panel global (métricas SaaS, salud de bandas, soporte, moderación, facturación, «ver como»).

Junta (escritorio) y músicos/familias (móvil) tienen la misma importancia.

## Product Purpose

Solfeamos es una plataforma SaaS multi-tenant para la gestión integral de bandas de música españolas. Cada banda es un tenant aislado con sus socios, archivo, ensayos, tesorería y material. El éxito es que una junta voluntaria lleve el día a día de la banda sin Excel ni papeles, y que músicos y familias encuentren lo que necesitan en segundos.

## Positioning

Dos ejes con el mismo peso:

1. **Específico para bandas de música españolas**: informe SGAE, modelo 182 y certificados de donantes, modelos 111/190 de refuerzos, lotería de Navidad, mayordomía de uniformes, escuela de música, facturas preparadas para VeriFactu, asambleas con quórum y libro de actas. Todo en un solo sitio.
2. **Red entre bandas**: BandMarket (compraventa de instrumentos), bolsa de refuerzos (músicos entre bandas) y préstamo de partituras.

## Operating Context

- Ensayos y actuaciones con convocatoria por sección o por socio, respuesta y pase de lista.
- Ciclo anual de la banda: cuotas y recibos, subvenciones y su justificación, lotería, asamblea general, matrícula de la escuela.
- Calendario sincronizado por ICS con Google, Apple y Outlook.
- Planes Free, Basic, Pro y Enterprise y add-ons por banda. Las funciones sin plan o sin permiso se ocultan, y su URL muestra una tarjeta de mejora.
- Estados del tenant que cambian la interfaz: prueba, impago con periodo de gracia, solo lectura, suspendida, «ver como» (solo lectura, auditado).

## Capabilities and Constraints

- Stack: SPA React y Vite (`apps/web`), API NestJS. Componentes propios en `apps/web/src/components`, sin librería de UI externa.
- Módulos: Inicio, Agenda, Notificaciones, Archivo musical, Ensayos y actuaciones, Asistencia, Contrataciones, Escuela, Portal de familias, Socios, Comunicaciones, Documentos, Tesorería, Mayordomía, Instrumentación, Gobierno, BandMarket, Bolsa de refuerzos, Ajustes, Plan y facturación, Soporte, Seguridad y Panel global.
- RBAC configurable por banda: la navegación depende del rol y del plan.
- Patrones de interacción documentados en `docs/ux-guidelines.md` (paleta de comandos ⌘K, pestañas con URL, migas de pan, estados de carga, vacío y error, menús WAI-ARIA, confirmaciones destructivas). Deben conservarse.
- Interfaz en español de España. La terminología es del dominio: socios, particellas, mayordomía, convocatoria, junta, actas.
- Tema claro y oscuro (el menú de usuario permite cambiarlo).
- **Requisito confirmado, aún sin construir:** cada banda puede elegir una plantilla de colores entre unas predefinidas, que debe convivir con la identidad de la plataforma.

## Brand Commitments

- **Solfeamos** es el nombre definitivo de la plataforma SaaS, con su logotipo y su combinación de colores propia.
- El logotipo de la plataforma se sube desde el panel global (Marca) y se sirve en `/api/v1/brand/logo`. No está en el repositorio.
- Cada banda tiene su propio logotipo (Ajustes) y elegirá una plantilla de colores predefinida. La marca de la banda vive dentro del marco de Solfeamos y no lo sustituye.
- **Abierto:** los valores exactos de la combinación de colores de Solfeamos no están documentados en el repositorio. La paleta actual de la interfaz (azul pizarra) y la del `DESIGN.md` raíz (morado Material) no son autoridad: el usuario ha pedido una identidad nueva.

## Evidence on Hand

- Banda de demostración `banda-demo` con datos ficticios (`SEED_DEMO=true pnpm db:seed`).
- No hay testimonios, clientes reales, cifras de uso ni capturas de producción en el repositorio. No deben inventarse.

## Product Principles

1. **El tiempo del voluntario es sagrado:** cada tarea frecuente de la junta debe resolverse en pocos pasos, con datos densos y fáciles de escanear.
2. **El móvil es de primera clase para músicos y familias:** convocatorias, agenda, asistencia y portal funcionan perfectamente a 375px.
3. **Del dominio, no genérico:** se usan el vocabulario y los rituales de una banda de música, no los de un CRM.
4. **Confianza y cumplimiento:** datos personales cifrados, RGPD y documentos fiscales; la interfaz transmite rigor y nunca oculta consecuencias.
5. **Lo que no puedes usar no estorba:** permisos y plan dan forma a la interfaz sin callejones sin salida.

## Accessibility & Inclusion

WCAG 2.2 AA: navegación completa con teclado, foco visible, contraste AA (también en bordes de campo, 3:1), objetivos táctiles de 44px en móvil, `prefers-reduced-motion` respetado y títulos de página por pantalla. Usuarios de edades muy distintas (alumnos, familias, músicos veteranos).
