---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/components/AppShell.tsx","src/styles/tokens.css","src/styles/app.css"]
---

# Surface brief · Aplicación web de Solfeamos (toda la app de banda + panel global)

Scope: todas las pantallas de `apps/web` (shell, componentes base, módulos de banda, acceso, onboarding, portal de familias, panel global). Mode: Operate.

Audience/job: junta voluntaria en escritorio (tareas densas) y músicos/familias en móvil (convocatorias, agenda, portal). Constraints: conservar el tema oscuro; mantener funciones, rutas, permisos, accesibilidad WCAG 2.2 AA y los tests existentes.

Unresolved: valores oficiales de la paleta de Solfeamos (la dirección propone la paleta cobalto/esmalte como identidad de plataforma); plantillas de color por banda (requisito confirmado, sin construir).

## Direction contract

THESIS: La banda se orienta como en su propia sede: la navegación y los datos clave son placas esmaltadas sobre azulejo vidriado. Rechaza el panel SaaS gris con un acento azul y el folclore de pentagramas.

OWN-WORLD: Raíl en cobalto profundo, fondo de esmalte blanco frío, superficies blancas con canto de 1px; leyenda de esmaltes con un trabajo cada uno (cobalto navega/primario, ocre atención/pendiente, verde confirmado/cobrado, manganeso escuela, rojo crítico). Archivo con eje de anchura: estrecha para títulos y placas, normal para UI, cifras tabulares. Color plano, sin degradados ni sombras difusas. Módulo de 8px.

STORY: La junta entiende en un vistazo qué toca hoy y qué está pendiente; el músico confirma su asistencia en un gesto; el equipo de plataforma lee la salud de cada banda.

FIRST VIEWPORT: Raíl cobalto de 248px (marca, banda activa, grupos, contadores ocre), barra superior blanca con buscador ⌘K de 420px; Inicio: título 32px estrecho con dos acciones, placa de la próxima convocatoria con Asisto/No asisto, tres cifras, semana como fila de azulejos con leyenda, columna derecha «Pendiente de la junta».

FORM: Azulejo y placa esmaltada de la Sociedad Musical, candidata 5 de 7 de la lista propia; seed:b20f4bde28e9ac3b. Gesto distintivo: la placa esmaltada (campo cobalto con filete blanco interior) para la cabecera de módulo y el dato principal, y la semana/agenda como azulejos teñidos por esmalte. Movimiento: transiciones de 150ms, sin rebotes; reduced-motion las anula.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
