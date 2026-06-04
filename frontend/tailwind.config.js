/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class', // Soporte para tema oscuro nativo
  theme: {
    extend: {
      colors: {
        // Mapeo semántico profesional extraído de la identidad visual 'LabSOM'
        background: {
          DEFAULT: '#050508', // Obsidiana ultra profunda (fondo general)
          alt: '#090b0f',     // Obsidiana secundaria para contraste
        },
        surface: {
          DEFAULT: '#0e121a', // Grafito obsidiana para tarjetas, páneles y barras
          hover: '#171d2b',   // Grafito de interacción para hovers
          active: '#1e2638',  // Grafito de selección activa
        },
        border: {
          DEFAULT: '#2a3447', // Gris metálico de la grilla para bordes y divisiones
          muted: '#181f2b',   // Borde sutil de bajo contraste
        },
        primary: {
          DEFAULT: '#00f0ff', // Cian neón cyber (nodo activo, indicadores clave)
          hover: '#33f3ff',   // Variación de brillo para hover de botones cian
          glow: 'rgba(0, 240, 255, 0.4)', // Sombra resplandeciente
        },
        secondary: {
          DEFAULT: '#0088ff', // Azul eléctrico (trayectorias dinámicas, enlaces activos)
          hover: '#33a0ff',   // Variación de brillo en hover
          glow: 'rgba(0, 136, 255, 0.3)', // Sombra resplandeciente
        },
        accent: {
          DEFAULT: '#0044ff', // Cobalto cyber profundo (glows de fondo, splines profundos)
          glow: 'rgba(0, 68, 255, 0.25)',
        },
        neutral: {
          title: '#ffffff',     // Títulos en blanco puro de alto contraste
          body: '#cbd5e1',      // Texto de cuerpo en gris slate-300 (legibilidad premium)
          muted: '#64748b',     // Texto secundario y deshabilitados (slate-500)
          glow: '#a8f5ff',      // Resplandor cian suave para nodos destacados
        }
      },
      boxShadow: {
        // Sombras con resplandor glow premium basadas en los colores del logotipo
        'glow-primary': '0 0 15px rgba(0, 240, 255, 0.35), 0 0 5px rgba(0, 240, 255, 0.2)',
        'glow-secondary': '0 0 15px rgba(0, 136, 255, 0.3), 0 0 5px rgba(0, 136, 255, 0.15)',
        'glow-accent': '0 0 25px rgba(0, 68, 255, 0.25)',
        'glow-nodes': '0 0 8px #a8f5ff, 0 0 3px rgba(0, 240, 255, 0.8)',
      },
      backgroundImage: {
        // Degradados dinámicos simulando la trayectoria spline del logotipo
        'gradient-spline': 'linear-gradient(135deg, #00f0ff 0%, #0088ff 50%, #0044ff 100%)',
        'gradient-radial-glow': 'radial-gradient(circle at center, rgba(0, 240, 255, 0.15) 0%, rgba(5, 5, 8, 0) 70%)',
      },
      animation: {
        // Animaciones sutiles de pulso para la red y trayectoria del SOM
        'pulse-glow': 'pulse-glow 3s infinite ease-in-out',
        'spline-flow': 'spline-flow 8s infinite linear',
      },
      keyframes: {
        'pulse-glow': {
          '0%, 100%': { transform: 'scale(1)', opacity: '1', filter: 'drop-shadow(0 0 2px #00f0ff)' },
          '50%': { transform: 'scale(1.05)', opacity: '0.8', filter: 'drop-shadow(0 0 8px #00f0ff)' },
        },
        'spline-flow': {
          '0%': { strokeDashoffset: '24' },
          '100%': { strokeDashoffset: '0' },
        }
      }
    },
  },
  plugins: [],
}
