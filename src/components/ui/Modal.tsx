
"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

type ModalProps = {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
};

export default function Modal({ isOpen, onClose, title, children }: ModalProps) {
    const overlayRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        if (isOpen) {
            document.addEventListener("keydown", handleEscape);
            document.body.style.overflow = "hidden";
        }
        return () => {
            document.removeEventListener("keydown", handleEscape);
            document.body.style.overflow = "";
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return createPortal(
        <div className="pcal-modal-overlay" ref={overlayRef} onClick={(e) => {
            if (e.target === overlayRef.current) onClose();
        }}>
            <div className="pcal-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
                <button className="pcal-modal-close" onClick={onClose} aria-label="Close">×</button>
                <div className="pcal-modal-body">
                    <h2 className="pcal-modal-title" style={{ marginTop: 0, marginBottom: '1rem' }}>{title}</h2>
                    {children}
                </div>
            </div>
        </div>,
        document.body
    );
}
