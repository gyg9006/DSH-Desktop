/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 赛博朋克 / Tech-noir 色板（深色为主）——RGB 通道变量（支持 /opacity 修饰符，主题全局化）
        cyber: {
          bg: 'rgb(var(--color-bg-rgb, 10 12 18) / <alpha-value>)',
          panel: 'rgb(var(--color-panel-rgb, 16 19 28) / <alpha-value>)',
          panel2: 'rgb(var(--color-panel2-rgb, 22 26 38) / <alpha-value>)',
          border: 'rgb(var(--color-border-rgb, 30 36 51) / <alpha-value>)',
          neon: 'rgb(var(--color-primary-rgb, 0 229 255) / <alpha-value>)',
          violet: 'rgb(var(--color-secondary-rgb, 139 92 246) / <alpha-value>)',
          pink: 'rgb(var(--color-accent-rgb, 240 171 252) / <alpha-value>)',
          green: 'rgb(var(--color-green-rgb, 34 229 132) / <alpha-value>)',
          red: 'rgb(var(--color-red-rgb, 255 77 106) / <alpha-value>)',
          amber: 'rgb(var(--color-amber-rgb, 255 176 32) / <alpha-value>)',
          text: 'rgb(var(--color-text-rgb, 230 234 242) / <alpha-value>)',
          dim: 'rgb(var(--color-dim-rgb, 139 147 167) / <alpha-value>)',
          faint: '#5A6278'
        },
        // DeepSeek Harness 品牌蓝（保留兼容）
        brand: {
          DEFAULT: '#3B82F6',
          light: '#4D93F8',
          dark: '#2563EB'
        },
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
      boxShadow: {
        'glow-neon': '0 0 12px rgba(0,229,255,0.45), 0 0 32px rgba(0,229,255,0.15)',
        'glow-violet': '0 0 12px rgba(139,92,246,0.45), 0 0 32px rgba(139,92,246,0.15)',
        'glow-green': '0 0 10px rgba(34,229,132,0.4)',
        'glass': '0 8px 32px rgba(0,0,0,0.45)'
      },
      backdropBlur: {
        glass: '14px'
      },
      backgroundImage: {
        'cyber-grid':
          'linear-gradient(rgba(0,229,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0,229,255,0.05) 1px, transparent 1px)',
        'cyber-glow': 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(0,229,255,0.12), transparent)'
      },
      borderRadius: {
        dsh: '12px'
      },
      animation: {
        'pulse-neon': 'pulse-neon 2s ease-in-out infinite',
        'scan': 'scan 3s linear infinite',
        'flow-x': 'flow-x 2.4s linear infinite',
        'fade-in': 'fade-in 0.35s ease-out both'
      },
      keyframes: {
        'pulse-neon': {
          '0%, 100%': { opacity: '1', boxShadow: '0 0 10px rgba(0,229,255,0.5)' },
          '50%': { opacity: '0.75', boxShadow: '0 0 4px rgba(0,229,255,0.2)' }
        },
        scan: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' }
        },
        'flow-x': {
          '0%': { backgroundPosition: '0% 50%' },
          '100%': { backgroundPosition: '200% 50%' }
        },
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        }
      }
    }
  },
  plugins: []
}
