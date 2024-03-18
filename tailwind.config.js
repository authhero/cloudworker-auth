module.exports = {
  darkMode: "class",
  content: [
    // wilcard from docs
    // "./src/**/*.tsx",
    "./src/utils/reactdemo.tsx",
    "./src/utils/components/Layout.tsx",
  ],
  theme: {
    extend: {
      screens: {
        short: {
          raw: "(max-height: 900px) and (min-width: 640px)", // 640px = sm. Prevent this from ever triggering on phones
        },
      },
      colors: {
        primary: "var(--primary-color)",
        primaryHover: "var(--primary-hover)",
        textOnPrimary: "var(--text-on-primary)",
      },
    },
  },
  presets: [require("./tailwind.shared.config.js")],
};
