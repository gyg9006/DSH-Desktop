/// <reference types="vite/client" />

/** React 19：为 <webview> 标签补充 JSX 类型（Electron 内嵌 dsh Web UI）。 */
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string
        partition?: string
        style?: React.CSSProperties
        allowpopups?: string
      }
    }
  }
}

export {}
