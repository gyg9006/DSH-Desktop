/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{vue,ts}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // DeepSeek Harness 品牌蓝（dsh web 设计令牌 blue-500/450/600）
        brand: {
          DEFAULT: '#3B82F6',
          light: '#4D93F8',
          dark: '#2563EB'
        },
        // dsh neutral-bluish 中性色板
        dsh: {
          50: '#F9FAFB',
          60: '#F5F6F7',
          100: '#EBEEF2',
          150: '#E9ECF2',
          200: '#E1E5EE',
          300: '#CFD3D6',
          400: '#ADB2B8',
          500: '#979DA6',
          600: '#81858C',
          700: '#61666B',
          1000: '#0F1115'
        }
      },
      borderRadius: {
        dsh: '12px'
      }
    }
  },
  plugins: []
}
