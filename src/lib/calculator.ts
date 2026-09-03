export type CalculatorOperation = 'add' | 'subtract' | 'multiply' | 'divide';

interface RepeatedOperation {
	operation: CalculatorOperation;
	operand: number;
	percentRate: number | null;
}

export interface CalculatorState {
	display: string;
	value: number;
	phase: 'entry' | 'result' | 'waiting' | 'error';
	accumulator: number | null;
	operation: CalculatorOperation | null;
	repeat: RepeatedOperation | null;
	percentRate: number | null;
}

export function createCalculatorState(): CalculatorState {
	return {
		display: '0',
		value: 0,
		phase: 'entry',
		accumulator: null,
		operation: null,
		repeat: null,
		percentRate: null,
	};
}

function formatResult(value: number) {
	const rounded = Number(value.toPrecision(12));
	const text = String(rounded);
	return text.length > 14 ? rounded.toExponential(8) : text;
}

function setEntry(state: CalculatorState, display: string) {
	state.display = display;
	state.value = Number(display);
	state.phase = 'entry';
	state.percentRate = null;
}

function setResult(state: CalculatorState, value: number) {
	if (!Number.isFinite(value)) {
		Object.assign(state, createCalculatorState(), { display: 'Error', phase: 'error' });
		return;
	}
	// Keep full precision for subsequent operations; rounding is only for display.
	state.value = value;
	state.display = formatResult(value);
	state.phase = 'result';
}

function calculate(left: number, right: number, operation: CalculatorOperation) {
	switch (operation) {
		case 'add':
			return left + right;
		case 'subtract':
			return left - right;
		case 'multiply':
			return left * right;
		case 'divide':
			return left / right;
	}
}

export function inputCalculator(state: CalculatorState, key: string) {
	if (key === 'clear') {
		Object.assign(state, createCalculatorState());
		return;
	}
	if (state.phase === 'error') {
		if (!/^\d$/.test(key) && key !== '.' && key !== 'sign' && key !== 'backspace') return;
		Object.assign(state, createCalculatorState());
	}
	if (/^\d$/.test(key)) {
		if (state.phase !== 'entry') {
			setEntry(state, key);
		} else if (state.display.replace(/\D/g, '').length < 12) {
			const prefix = state.display === '0' ? '' : state.display === '-0' ? '-' : state.display;
			setEntry(state, prefix + key);
		}
		return;
	}
	if (key === '.') {
		if (state.phase !== 'entry') setEntry(state, '0.');
		else if (!state.display.includes('.')) setEntry(state, state.display + '.');
		return;
	}
	if (key === 'backspace') {
		if (state.phase !== 'entry') return;
		const shortened = state.display.slice(0, -1);
		setEntry(state, shortened === '' || shortened === '-' ? '0' : shortened);
		return;
	}
	if (key === 'sign') {
		if (state.phase === 'waiting') {
			setEntry(state, '-0');
		} else if (state.phase === 'entry') {
			setEntry(state, state.display.startsWith('-') ? state.display.slice(1) : '-' + state.display);
		} else {
			setResult(state, -state.value);
			if (state.percentRate !== null) state.percentRate *= -1;
		}
		return;
	}
	if (key === 'percent') {
		const rate = state.value / 100;
		const relative = state.operation === 'add' || state.operation === 'subtract';
		const result = relative && state.accumulator !== null ? state.accumulator * rate : rate;
		setResult(state, result);
		if (state.phase !== 'error') state.percentRate = relative ? rate : null;
		return;
	}
	if (key === 'equals') {
		if (state.operation && state.accumulator !== null) {
			const repeat = {
				operation: state.operation,
				operand: state.value,
				percentRate: state.percentRate,
			};
			setResult(state, calculate(state.accumulator, state.value, state.operation));
			if (state.phase === 'error') return;
			state.repeat = repeat;
		} else if (state.repeat) {
			const { operation, operand, percentRate } = state.repeat;
			const right = percentRate === null ? operand : state.value * percentRate;
			setResult(state, calculate(state.value, right, operation));
		} else {
			setResult(state, state.value);
		}
		state.accumulator = null;
		state.operation = null;
		state.percentRate = null;
		return;
	}
	if (key === 'add' || key === 'subtract' || key === 'multiply' || key === 'divide') {
		if (state.operation && state.accumulator !== null && state.phase !== 'waiting') {
			setResult(state, calculate(state.accumulator, state.value, state.operation));
			if (state.phase === 'error') return;
		}
		state.accumulator = state.value;
		state.operation = key;
		state.phase = 'waiting';
		state.repeat = null;
		state.percentRate = null;
	}
}
