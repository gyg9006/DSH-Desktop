/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 赛博朋克 / Tech-noir 色板（深色为主）
        cyber: {
          bg: '#0A0C12', // 全局背景
          panel: '#10131C', // 面板 / 卡片
          panel2: '#161A26', // 次级面板
          border: '#1E2433', // 边框
          neon: '#00E5FF', // 青色霓虹（主强调）
          violet: '#8B5CF6', // 紫霓虹
          pink: '#F0ABFC',
          green: '#22E584', // 状态绿
          red: '#FF4D6A', // 状态红 / 危险
          amber: '#FFB020',
          text: '#E6EAF2',
          dim: '#8B93A7',
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
