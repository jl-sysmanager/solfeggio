# Pautas de UX/UI

Estas pautas complementan el sistema visual, que replica el de [Breeze](https://github.com/lanternops/breeze) (ver la sección de interfaz de [architecture.md](architecture.md)). Aquí se recogen los patrones de interacción y los componentes que debe usar cualquier pantalla nueva. Todos están en `apps/web/src/components`.

## Navegación y orientación

| Patrón | Componente | Regla |
|---|---|---|
| Barra lateral con iconos | `AppShell` + `nav.ts` | Cada módulo lleva un icono (`icon` en `nav.ts`). Las entradas sin permiso o sin funcionalidad en el plan no se muestran. |
| Paleta de comandos | `CommandPalette` | **⌘K / Ctrl+K**, o el campo «Buscar…» de la barra superior. Sirve para ir a cualquier módulo visible, lanzar acciones frecuentes («Dar de alta a un socio», «Planificar ensayo») y buscar el texto escrito en socios o en el archivo. Los resultados se filtran sin distinguir tildes. |
| Migas de pan | `PageHeader` | `Inicio / Sección / Página`. «Inicio» es un enlace y la página actual lleva `aria-current="page"`. |
| Título de la pestaña | `PageHeader` | Cada pantalla fija `document.title = "<Título> · Solfeggio"` (WCAG 2.4.2). |
| Foco tras navegar | `AppShell` | El foco pasa al `h1` de la nueva página, así que los lectores de pantalla anuncian el cambio. |
| Menú de usuario | `Menu` + `Avatar` | Agrupa seguridad, cambio de banda, tema y cierre de sesión. No se ponen botones de cuenta sueltos en la barra. |
| Avisos de estado | `AppShell` | La franja de estado sólo aparece si hay algo que hacer (pago pendiente, sólo lectura, prueba) y enlaza a facturación. |

## Datos

- **Tablas:** usa `DataTable`. Las cifras van con `numeric` (alineadas a la derecha y en monoespaciada) y las fechas, importes y códigos con `nowrap`.
- **Acciones de fila:** con dos o más, se agrupan en un `Menu` («⋯») con la etiqueta `Acciones de <nombre>`. La acción destructiva va la última y con `danger`. La columna «Acciones» queda fija a la derecha para que nunca se oculte.
- **Personas:** se muestran con `Person` (avatar con iniciales, nombre y un detalle como el email o el rol).
- **Métricas:** `StatCard` con `icon` e `iconColor`, cifra en monoespaciada y `hint` o `meter`. Las tasas se pasan como fracción de 0 a 1.

## Estados

| Estado | Componente | Regla |
|---|---|---|
| Cargando | `Loading` | Esqueleto que reserva el espacio, para que la página no salte, y anuncia «Cargando…» con `role="status"`. |
| Vacío | `EmptyState` | Icono, título, una frase y, si existe, la acción que lo resuelve. |
| Error al cargar | `ErrorNote` | Aviso con `role="alert"` y, si es posible, un botón «Reintentar». |
| Confirmación | `useApiMutation({ success })` | Aviso breve que desaparece solo a los 5 s. |
| Error de una acción | `toast.error` | **No desaparece solo**: hay que leerlo y actuar. Se cierra con el botón ×. |
| Acción destructiva | `ConfirmModal` | Explica la consecuencia y usa un verbo concreto en el botón («Dar de baja», no «Aceptar»). |

## Teclado y accesibilidad

- **Menús** (`Menu`): siguen el patrón WAI-ARIA *menu button*. Intro, Espacio o ↓ abren el menú; ↑, ↓, Inicio y Fin navegan; Esc o Tab cierran y devuelven el foco al botón. El menú se pinta en un portal con posición fija, así que ningún contenedor con desplazamiento lo recorta.
- **Paleta:** combobox con `aria-activedescendant`. ↑ y ↓ mueven la selección, Intro abre la opción y Esc cierra la paleta y devuelve el foco.
- **Etiquetas:** los botones con sólo un icono llevan `aria-label`. Las etiquetas dicen qué hacen («Dar de baja», «Probar conexión») y el nombre accesible incluye el texto visible (WCAG 2.5.3).
- **Objetivos táctiles:** al menos 32px, y 44px en móvil para pestañas y filtros.
- **Movimiento:** las animaciones (esqueletos, transiciones) se desactivan con `prefers-reduced-motion`.

## Revisión rápida de una pantalla nueva

- [ ] Usa `Page` + `PageHeader` con `eyebrow` (migas), título, descripción y como mucho una acción principal.
- [ ] Muestra `Loading`, `ErrorNote` y `EmptyState` en lugar de texto suelto.
- [ ] Las tablas tienen `caption`, columnas `numeric` y `nowrap` donde toca, y las acciones agrupadas en `Menu`.
- [ ] Los botones con sólo un icono tienen `aria-label`.
- [ ] Las acciones destructivas piden confirmación.
- [ ] Funciona a 375px sin desplazamiento horizontal, y con teclado de principio a fin.
