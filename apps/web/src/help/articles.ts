import type { HelpArticle } from './types';

/** Textos de ayuda en español para cada módulo del tenant. */
export const ARTICLES: Record<string, HelpArticle> = {
  home: {
    id: 'home',
    title: 'Inicio',
    summary: 'Resumen del día a día de la banda: próximos ensayos, avisos y accesos rápidos.',
    sections: [
      {
        heading: 'Qué verás aquí',
        bullets: [
          'Próximos ensayos y actuaciones con enlace a la convocatoria.',
          'Accesos rápidos a las tareas más habituales de tu rol.',
          'Avisos si el plan no incluye un módulo o si hay que completar la puesta en marcha.',
        ],
      },
      {
        heading: 'Consejos',
        bullets: [
          'Si acabas de crear la banda, abre la guía de puesta en marcha (notificaciones o ?guia=1).',
          'Usa ⌘K / Ctrl+K para ir a cualquier módulo sin pasar por el menú.',
        ],
      },
    ],
  },
  agenda: {
    id: 'agenda',
    title: 'Agenda',
    summary: 'Vista de calendario de ensayos, actuaciones y otras fechas de la banda.',
    sections: [
      {
        heading: 'Cómo usarla',
        bullets: [
          'Consulta el mes o la lista de próximos eventos.',
          'Abre un evento para ver convocatoria, repertorio y asistencia.',
          'Los eventos se crean y editan en Ensayos y actuaciones.',
        ],
      },
      {
        heading: 'Sincronización (plan Pro)',
        paragraphs: ['Si tu plan incluye sincronización, puedes suscribir un calendario ICS en Google, Apple u Outlook desde Ajustes o la ficha del evento.'],
      },
    ],
  },
  notifications: {
    id: 'notifications',
    title: 'Notificaciones',
    summary: 'Avisos de la banda y de la plataforma: convocatorias, incidencias y recordatorios.',
    sections: [
      {
        heading: 'Qué incluye',
        bullets: [
          'Respuestas a convocatorias y cambios de ensayos.',
          'Mensajes de soporte y avisos de la plataforma.',
          'Acceso de nuevo a la guía de puesta en marcha si aún no la has cerrado.',
        ],
      },
      {
        heading: 'Consejo',
        paragraphs: ['Marca como leídas las que ya hayas atendido para mantener la bandeja limpia.'],
      },
    ],
  },
  archive: {
    id: 'archive',
    title: 'Archivo musical',
    summary: 'Catálogo de obras, partituras, préstamos y datos para el informe SGAE.',
    sections: [
      {
        heading: 'Flujo habitual',
        bullets: [
          'Da de alta una obra con título, compositor y datos de derechos.',
          'Sube particellas o la partitura completa a cada obra.',
          'Registra préstamos entre músicos o bandas cuando salga material del archivo.',
          'Usa la búsqueda y los filtros para localizar repertorio antes de un ensayo.',
        ],
      },
      {
        heading: 'Consejos',
        bullets: [
          'Completa los campos SGAE desde el principio: ahorran trabajo al cerrar el año.',
          'En planes con archivo asistido, puedes partir partituras con ayuda de la IA del plan.',
        ],
      },
    ],
  },
  events: {
    id: 'events',
    title: 'Ensayos y actuaciones',
    summary: 'Planifica ensayos y conciertos, convoca por sección o socio y lleva el repertorio del día.',
    sections: [
      {
        heading: 'Pasos típicos',
        bullets: [
          'Crea el evento con fecha, lugar y tipo (ensayo o actuación).',
          'Elige a quién convocar: toda la banda, secciones o socios concretos.',
          'Añade obras del archivo al repertorio del ensayo.',
          'Los músicos responden; tú sigues las confirmaciones y la asistencia.',
        ],
      },
      {
        heading: 'Consejo',
        paragraphs: ['Desde la ficha del evento puedes pasar lista y ver quién falta. La Agenda muestra el mismo calendario en otra vista.'],
      },
    ],
  },
  attendance: {
    id: 'attendance',
    title: 'Asistencia',
    summary: 'Resumen de asistencia a ensayos y actuaciones para seguir la implicación de la plantilla.',
    sections: [
      {
        heading: 'Cómo funciona',
        bullets: [
          'La asistencia se registra al pasar lista en cada evento.',
          'Aquí consultas estadísticas y rankings por periodo.',
          'Sirve para detectar ausencias reiteradas antes de una actuación importante.',
        ],
      },
    ],
  },
  performances: {
    id: 'performances',
    title: 'Contrataciones',
    summary: 'Presupuestos y facturas de actuaciones externas, con datos fiscales listos para tu gestoría.',
    sections: [
      {
        heading: 'Flujo',
        bullets: [
          'Crea una contratación con el cliente, fecha e importe.',
          'Emite presupuesto y, si se acepta, la factura asociada.',
          'Revisa retenciones e importes antes de enviar el documento.',
        ],
      },
      {
        heading: 'Consejo',
        paragraphs: ['Mantén al día la ficha fiscal de la banda en Ajustes: CIF y razón social salen en los documentos.'],
      },
    ],
  },
  school: {
    id: 'school',
    title: 'Escuela de música',
    summary: 'Alumnos, matrículas, cursos y mensualidades de la escuela vinculada a la banda.',
    sections: [
      {
        heading: 'Pasos habituales',
        bullets: [
          'Configura cursos e instrumentos de la escuela.',
          'Da de alta alumnos o recibe matrículas por el enlace público de inscripción.',
          'Lleva mensualidades y el seguimiento académico desde la ficha del alumno.',
          'En Configuración elige descuentos por porcentaje o tarifas fijas mensuales, y asigna la tarifa en la ficha del alumno.',
          'Los tutores usan el Portal de familias con su propio acceso.',
        ],
      },
      {
        heading: 'Plazas y plan',
        paragraphs: ['Las plazas de alumno dependen del add-on Escuela del plan. Si te quedas corto, revisa Plan y facturación.'],
      },
    ],
  },
  family: {
    id: 'family',
    title: 'Portal de familias',
    summary: 'Espacio para tutores: horarios, avisos escolares y seguimiento del alumno.',
    sections: [
      {
        heading: 'Qué pueden hacer las familias',
        bullets: [
          'Ver datos del alumno y del curso.',
          'Consultar horarios y comunicaciones de la escuela.',
          'Seguir mensualidades u otras gestiones que la banda haya habilitado.',
        ],
      },
      {
        heading: 'Consejo',
        paragraphs: ['La junta gestiona altas y permisos desde Escuela y Miembros; este portal es la vista del tutor.'],
      },
    ],
  },
  members: {
    id: 'members',
    title: 'Miembros',
    summary: 'Censo de socios, usuarios con acceso a la app, roles e invitaciones.',
    sections: [
      {
        heading: 'Conceptos',
        bullets: [
          'Socio: persona del censo (músico, colaborador…), con o sin acceso a la aplicación.',
          'Usuario: cuenta que inicia sesión; consume plaza del plan.',
          'Roles: definen qué puede hacer cada usuario (secretaría, tesorería, dirección…).',
        ],
      },
      {
        heading: 'Flujo típico',
        bullets: [
          'Da de alta al socio con instrumento y sección.',
          'Invita por email a quien deba entrar en la app y asígnale un rol.',
          'En la pestaña de acceso gestionas usuarios e invitaciones pendientes.',
        ],
      },
    ],
  },
  communications: {
    id: 'communications',
    title: 'Comunicaciones',
    summary: 'Envía avisos a la banda, a una sección o a socios concretos.',
    sections: [
      {
        heading: 'Cómo enviar',
        bullets: [
          'Redacta el mensaje y elige el destinatario (todos, sección o lista).',
          'Confirma el envío; los destinatarios lo verán en notificaciones o por el canal configurado.',
          'Úsalo para cambios de última hora, convocatorias extraordinarias o recordatorios.',
        ],
      },
    ],
  },
  documents: {
    id: 'documents',
    title: 'Documentos',
    summary: 'Archivo documental de la banda: estatutos, seguros, actas y ficheros compartidos.',
    sections: [
      {
        heading: 'Uso',
        bullets: [
          'Sube documentos y organízalos por carpetas o etiquetas según tu costumbre.',
          'Controla quién puede verlos con los permisos del rol.',
          'No sustituye al Archivo musical: aquí van papeles administrativos, no partituras.',
        ],
      },
    ],
  },
  treasury: {
    id: 'treasury',
    title: 'Tesorería',
    summary: 'Cuotas, recibos, movimientos, subvenciones, lotería y donantes.',
    sections: [
      {
        heading: 'Bloques principales',
        bullets: [
          'Cuotas y recibos de socios: genera, cobra y marca como pagados.',
          'Movimientos e ingresos/gastos del día a día.',
          'Subvenciones y justificación; lotería de Navidad; donantes y modelo 182 cuando aplique.',
        ],
      },
      {
        heading: 'Consejo',
        paragraphs: ['Antes del cierre fiscal, revisa con tu gestoría los listados que exportes. La ficha de la banda en Ajustes debe estar completa.'],
      },
    ],
  },
  wardrobe: {
    id: 'wardrobe',
    title: 'Mayordomía',
    summary: 'Uniformes, tallas y material de vestuario de la banda.',
    sections: [
      {
        heading: 'Flujo',
        bullets: [
          'Inventaría piezas (chaquetas, gorras, etc.) y tallas.',
          'Asigna o presta material a socios y registra devoluciones.',
          'Detecta faltantes antes de una actuación o desfile.',
        ],
      },
    ],
  },
  instruments: {
    id: 'instruments',
    title: 'Instrumentación',
    summary: 'Inventario de instrumentos de la banda, asignaciones y mantenimiento.',
    sections: [
      {
        heading: 'Cómo usarlo',
        bullets: [
          'Da de alta cada instrumento (marca, número de serie, estado).',
          'Asígnalo a un socio o márcalo como disponible / en taller.',
          'Anota mantenimientos y reparaciones en la ficha.',
        ],
      },
      {
        heading: 'Consejo',
        paragraphs: ['Para comprar o vender entre bandas usa BandMarket; este módulo es el inventario interno.'],
      },
    ],
  },
  governance: {
    id: 'governance',
    title: 'Gobierno',
    summary: 'Asambleas, quórum, votaciones y libro de actas.',
    sections: [
      {
        heading: 'Pasos de una asamblea',
        bullets: [
          'Crea la asamblea con orden del día y fecha.',
          'Convoca a los socios con derecho a voto.',
          'Registra asistencia (quórum), votaciones y el acta.',
          'Consulta el histórico en el libro de actas.',
        ],
      },
    ],
  },
  market: {
    id: 'market',
    title: 'BandMarket',
    summary: 'Mercadillo entre bandas: compra y venta de instrumentos y material.',
    sections: [
      {
        heading: 'Cómo funciona',
        bullets: [
          'Publica un anuncio con fotos, precio y estado del artículo.',
          'Los anuncios pasan moderación de la plataforma antes de verse en el mercado.',
          'Contacta con otras bandas desde el anuncio; cierra el trato fuera o según lo acordéis.',
        ],
      },
      {
        heading: 'Consejo',
        paragraphs: ['Describe bien el estado y adjunta fotos claras: acelera la moderación y genera más interés.'],
      },
    ],
  },
  reinforcements: {
    id: 'reinforcements',
    title: 'Bolsa de refuerzos',
    summary: 'Pide o ofrece músicos entre bandas para cubrir plazas en ensayos y actuaciones.',
    sections: [
      {
        heading: 'Dos lados',
        bullets: [
          'Como banda: publica una petición de refuerzo (instrumento, fecha, provincia).',
          'Como músico: mantén tu perfil disponible para que otras bandas te encuentren.',
          'Gestiona candidaturas y confirma el refuerzo desde la petición.',
        ],
      },
      {
        heading: 'Fiscalidad',
        paragraphs: ['Si pagáis al refuerzo, revisad retenciones e informes con vuestra gestoría; la plataforma ayuda a documentar el acuerdo.'],
      },
    ],
  },
  settings: {
    id: 'settings',
    title: 'Ajustes',
    summary: 'Datos de la banda, secciones e instrumentos de la plantilla.',
    sections: [
      {
        heading: 'Qué configurar',
        bullets: [
          'Ficha legal: razón social, CIF, logotipo y comunidad (salen en documentos).',
          'Secciones e instrumentos de la plantilla.',
          'Auditoría: historial de cambios sensibles (si tienes permiso).',
        ],
      },
      {
        heading: 'Consejo',
        paragraphs: ['Tras el alta, completar la ficha es el primer paso de la guía de puesta en marcha.'],
      },
    ],
  },
  billing: {
    id: 'billing',
    title: 'Plan y facturación',
    summary: 'Suscripción, add-ons, facturas de Solfeamos y estado del cobro.',
    sections: [
      {
        heading: 'Qué puedes hacer',
        bullets: [
          'Ver el plan actual, límites de usuarios y módulos incluidos.',
          'Mejorar de plan o activar add-ons (por ejemplo Escuela).',
          'Abrir el portal de Stripe para método de pago y facturas.',
        ],
      },
      {
        heading: 'Estados a vigilar',
        paragraphs: ['En prueba, impago o solo lectura verás avisos en la barra superior. Resuelve el cobro aquí para recuperar el acceso completo.'],
      },
    ],
  },
  incidents: {
    id: 'incidents',
    title: 'Soporte',
    summary: 'Incidencias con el equipo de Solfeamos: fallos, dudas de cuenta o peticiones.',
    sections: [
      {
        heading: 'Cómo abrir una incidencia',
        bullets: [
          'Describe el problema con el máximo de detalle (pantalla, qué esperabas, qué ocurrió).',
          'Adjunta capturas si ayudan.',
          'Sigue la conversación en el hilo hasta que se resuelva.',
        ],
      },
      {
        heading: 'Antes de escribir',
        paragraphs: ['Prueba el botón «Cómo funciona» de cada pantalla: muchas dudas de uso se resuelven ahí sin ticket.'],
      },
    ],
  },
  account: {
    id: 'account',
    title: 'Mi cuenta',
    summary: 'Tu perfil, seguridad (MFA), contraseña y consentimientos.',
    sections: [
      {
        heading: 'Pestañas habituales',
        bullets: [
          'Perfil: nombre y datos de contacto.',
          'Seguridad: contraseña y verificación en dos pasos (recomendado para quien administra).',
          'Privacidad / consentimientos: bases legales del tratamiento de datos.',
        ],
      },
      {
        heading: 'Consejo',
        paragraphs: ['Activa MFA en la cuenta con la que gestionas la banda; es un paso de la guía de puesta en marcha.'],
      },
    ],
  },
};
