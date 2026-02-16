
"use client";

import { useState, useEffect } from 'react';
import { ActivityType, ActivityPriority, Units } from '@prisma/client';
import Modal from '@/components/ui/Modal';

type ActivityFormProps = {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (data: ActivityFormData) => Promise<void>;
    onDelete?: (id: string) => Promise<void>;
    initialData?: Partial<ActivityFormData> & { id?: string };
    title?: string;
    dayId?: string; // Optional context
};

export type ActivityFormData = {
    type: ActivityType;
    title: string;
    duration?: number;
    distance?: number;
    distanceUnit?: Units;
    paceTarget?: string;
    effortTarget?: string;
    notes?: string;
    priority?: ActivityPriority;
    mustDo?: boolean;
};

const ACTIVITY_TYPES: ActivityType[] = [
    'RUN', 'STRENGTH', 'CROSS_TRAIN', 'REST', 'MOBILITY', 'YOGA', 'HIKE', 'OTHER'
];

export default function ActivityForm({ isOpen, onClose, onSubmit, onDelete, initialData, title }: ActivityFormProps) {
    const [formData, setFormData] = useState<ActivityFormData>({
        type: 'RUN',
        title: '',
        distanceUnit: 'KM',
        priority: 'MEDIUM',
        mustDo: false,
        ...initialData
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen) {
            setFormData({
                type: initialData?.type || 'RUN',
                title: initialData?.title || '',
                duration: initialData?.duration,
                distance: initialData?.distance,
                distanceUnit: initialData?.distanceUnit || 'KM',
                paceTarget: initialData?.paceTarget,
                effortTarget: initialData?.effortTarget,
                notes: initialData?.notes,
                priority: initialData?.priority || 'MEDIUM',
                mustDo: initialData?.mustDo || false
            });
            setError(null);
        }
    }, [isOpen, initialData]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setIsSubmitting(true);
        try {
            await onSubmit(formData);
            onClose();
        } catch (err: any) {
            setError(err.message || 'Failed to save activity');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async () => {
        if (!onDelete || !initialData?.id) return;
        if (!confirm('Delete this activity permanently?')) return;

        setIsSubmitting(true);
        try {
            await onDelete(initialData.id);
            onClose();
        } catch (err: any) {
            setError(err.message || 'Failed to delete');
            setIsSubmitting(false);
        }
    };

    const isRun = formData.type === 'RUN' || formData.type === 'HIKE';

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={title || (initialData?.title ? 'Edit Activity' : 'Add Activity')}>
            <form onSubmit={handleSubmit} className="form-stack">
                <label>
                    Type
                    <select
                        value={formData.type}
                        onChange={(e) => setFormData({ ...formData, type: e.target.value as ActivityType })}
                    >
                        {ACTIVITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                </label>

                <label>
                    Title
                    <input
                        type="text"
                        value={formData.title}
                        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                        required
                        placeholder="e.g. Long Run"
                    />
                </label>

                <div className="grid-2">
                    <label>
                        Duration (min)
                        <input
                            type="number"
                            value={formData.duration || ''}
                            onChange={(e) => setFormData({ ...formData, duration: e.target.value ? Number(e.target.value) : undefined })}
                            placeholder="e.g. 60"
                        />
                    </label>

                    {isRun && (
                        <label>
                            Distance
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <input
                                    type="number"
                                    step="0.1"
                                    value={formData.distance || ''}
                                    onChange={(e) => setFormData({ ...formData, distance: e.target.value ? Number(e.target.value) : undefined })}
                                    placeholder="e.g. 10"
                                    style={{ flex: 1 }}
                                />
                                <select
                                    value={formData.distanceUnit || 'KM'}
                                    onChange={(e) => setFormData({ ...formData, distanceUnit: e.target.value as Units })}
                                    style={{ width: '80px' }}
                                >
                                    <option value="KM">km</option>
                                    <option value="MILES">mi</option>
                                </select>
                            </div>
                        </label>
                    )}
                </div>

                {isRun && (
                    <label>
                        Pace Target
                        <input
                            type="text"
                            value={formData.paceTarget || ''}
                            onChange={(e) => setFormData({ ...formData, paceTarget: e.target.value || undefined })}
                            placeholder="e.g. 5:00-5:15"
                        />
                    </label>
                )}

                <label>
                    Notes
                    <textarea
                        value={formData.notes || ''}
                        onChange={(e) => setFormData({ ...formData, notes: e.target.value || undefined })}
                        rows={3}
                        style={{
                            width: '100%',
                            padding: '10px 12px',
                            borderRadius: '8px',
                            border: '1px solid var(--border)',
                            fontFamily: 'inherit',
                            background: 'var(--background)'
                        }}
                    />
                </label>

                <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginTop: '8px' }}>
                    <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px', fontWeight: 'normal' }}>
                        <input
                            type="checkbox"
                            checked={formData.mustDo || false}
                            onChange={(e) => setFormData({ ...formData, mustDo: e.target.checked })}
                            style={{ width: 'auto' }}
                        />
                        Must Do
                    </label>

                    <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}>
                        Priority:
                        <select
                            value={formData.priority || 'MEDIUM'}
                            onChange={(e) => setFormData({ ...formData, priority: e.target.value as ActivityPriority })}
                            style={{ width: 'auto', padding: '6px 10px' }}
                        >
                            <option value="KEY">Key</option>
                            <option value="MEDIUM">Normal</option>
                            <option value="OPTIONAL">Optional</option>
                        </select>
                    </label>
                </div>

                {error && <p style={{ color: 'var(--red)', fontSize: '14px' }}>{error}</p>}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px' }}>
                    {onDelete && initialData?.id && (
                        <button
                            type="button"
                            className="btn-ghost"
                            style={{ color: 'var(--red)', borderColor: 'var(--red)', marginRight: 'auto' }}
                            onClick={handleDelete}
                            disabled={isSubmitting}
                        >
                            Delete
                        </button>
                    )}
                    <button type="button" className="btn-ghost" onClick={onClose} disabled={isSubmitting}>
                        Cancel
                    </button>
                    <button type="submit" className="cta" disabled={isSubmitting}>
                        {isSubmitting ? 'Saving...' : 'Save Activity'}
                    </button>
                </div>
            </form>
        </Modal>
    );
}
