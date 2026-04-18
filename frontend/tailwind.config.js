/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        sand: "#f4ede2",
        ink: "#122033",
        teal: "#0f8b8d",
        coral: "#d95d39",
        moss: "#2d6a4f",
        wheat: "#e3c567"
      },
      fontFamily: {
        display: ["'Space Grotesk'", "sans-serif"],
        mono: ["'IBM Plex Mono'", "monospace"]
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(15,139,141,0.25), 0 20px 40px rgba(18,32,51,0.12)"
      },
      keyframes: {
        drift: {
          "0%, 100%": { transform: "translate3d(0, 0, 0)" },
          "50%": { transform: "translate3d(12px, -14px, 0)" }
        }
      },
      animation: {
        drift: "drift 8s ease-in-out infinite"
      }
    }
  },
  plugins: []
};
