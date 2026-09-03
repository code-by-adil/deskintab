import type { ProjectEvidence, ProjectStep } from '🍎/lib/projects/projects';

export type ProjectDraft =
	| {
			kind: 'project';
			isNew: boolean;
			path: string;
			title: string;
			objective: string;
			context: string;
			taskListPath: string;
			references: ProjectEvidence[];
	  }
	| {
			kind: 'start';
			agent: string;
			objective: string;
			steps: string;
	  }
	| {
			kind: 'checkpoint';
			runId: string;
			status: 'working' | 'waiting' | 'paused' | 'completed';
			summary: string;
			nextAction: string;
			steps: ProjectStep[];
			evidence: ProjectEvidence[];
			question: string;
			options: string;
	  }
	| {
			kind: 'answer';
			decisionId: string;
			question: string;
			options: string[];
			answer: string;
	  };
