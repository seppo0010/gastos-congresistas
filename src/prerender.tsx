import { renderToString } from 'react-dom/server'
import App from './App'

export async function prerender() {
  const html = renderToString(<App initialPathname="/" initialSearch="" />)

  return { html }
}
