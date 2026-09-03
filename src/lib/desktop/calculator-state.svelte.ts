import { createCalculatorState, inputCalculator, type CalculatorOperation } from '../calculator';
import { AppError } from '../errors';
export const calculatorState = $state(createCalculatorState());
// WebMCP uses structured cloning, which cannot carry nested reactive proxies.
export function calculatorSnapshot() {
	return $state.snapshot(calculatorState);
}
export function calculatorInput(key: string) {
	inputCalculator(calculatorState, key);
}
export function calculatorCalculate(
	operation: CalculatorOperation | 'set' | 'clear' | 'sign' | 'percent' | 'equals',
	value?: number,
	operand?: number,
) {
	const binary = ['add', 'subtract', 'multiply', 'divide'].includes(operation);
	if ((binary && operand === undefined) || (!binary && operand !== undefined))
		throw new AppError(
			'INVALID_INPUT',
			'Binary operations require operand; other operations do not accept operand.',
		);
	if (operation === 'set' && value === undefined)
		throw new AppError('INVALID_INPUT', 'set requires value.');
	if (operation === 'clear' && value !== undefined)
		throw new AppError('INVALID_INPUT', 'clear does not accept value.');
	if ([value, operand].some((number) => number !== undefined && !Number.isFinite(number)))
		throw new AppError('INVALID_INPUT', 'Calculator values must be finite numbers.');
	const set = (number: number) =>
		Object.assign(calculatorState, {
			display: String(number),
			value: number,
			phase: 'entry',
			percentRate: null,
		});
	if (value !== undefined || binary) {
		const startingValue = value ?? calculatorState.value;
		calculatorInput('clear');
		set(startingValue);
	}
	if (operation === 'set') {
		calculatorInput('equals');
		return;
	}
	calculatorInput(operation);
	if (binary) {
		set(operand!);
		calculatorInput('equals');
	}
}
