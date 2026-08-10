import type { ReactNode } from 'react'
import { X } from '@phosphor-icons/react'

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-handle" />
      <header className="modal-head"><div><p className="eyebrow">Gutscheinbox</p><h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Schließen"><X size={21} /></button></header>
      {children}
    </section>
  </div>
}

export function Field({ label, helper, error, children }: { label: string; helper?: string; error?: string; children: ReactNode }) {
  return <div className="field"><label>{label}</label>{children}{helper && <small>{helper}</small>}{error && <span className="error">{error}</span>}</div>
}

export function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return <div className="empty">{icon}<h2>{title}</h2><p className="subtle">{text}</p>{action}</div>
}
