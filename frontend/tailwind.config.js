/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#1677ff",
        ink: "#111827",
        surface: "#f4f7fb"
      }
    }
  },
  plugins: []
};
