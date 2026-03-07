import styles from './UploadFlowStepper.module.css';

type UploadFlowStep = {
  title: string;
  detail: string;
};

type UploadFlowStepperProps = {
  steps: readonly UploadFlowStep[];
  activeStep: number;
};

export default function UploadFlowStepper({ steps, activeStep }: UploadFlowStepperProps) {
  return (
    <ol className={styles.stepper} aria-label="Upload flow">
      {steps.map((step, index) => {
        const stepNo = index + 1;
        const isComplete = stepNo < activeStep;
        const isActive = stepNo === activeStep;
        const rowClass = isActive ? styles.rowActive : isComplete ? styles.rowComplete : '';
        const markerLabel = isComplete ? '✓' : String(stepNo);
        return (
          <li
            key={`${step.title}-${stepNo}`}
            className={`${styles.row} ${rowClass}`.trim()}
            aria-current={isActive ? 'step' : undefined}
          >
            <div className={styles.markerCol} aria-hidden="true">
              <span className={styles.marker}>{markerLabel}</span>
              {index < steps.length - 1 && <span className={styles.connector} />}
            </div>
            <div className={styles.content}>
              <p className={styles.eyebrow}>Step {stepNo}</p>
              <p className={styles.title}>{step.title}</p>
              <p className={styles.detail}>{step.detail}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
