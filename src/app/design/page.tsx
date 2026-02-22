// src/app/design/page.tsx
// No auth — purely for design iteration
export default function DesignSandbox() {
  return (
    <main>
      <h2 style={{ marginBottom: 24 }}>Design Sandbox</h2>
      <iframe src="/design/plan-review" style={{ width: '100%', height: 800, border: 'none' }} />
    </main>
  )
}
