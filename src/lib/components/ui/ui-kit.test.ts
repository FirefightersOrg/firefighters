import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Icon from './Icon.svelte';
import TextInput from './TextInput.svelte';
import Select from './Select.svelte';
import Checkbox from './Checkbox.svelte';
import RadioGroup from './RadioGroup.svelte';
import Button from './Button.svelte';
import ButtonHarness from './test-harness/ButtonHarness.svelte';
import FieldHarness from './test-harness/FieldHarness.svelte';
import { ICON_NAMES } from './icon-names';
import { Button as BarrelButton, Field } from './index';

const html = (component: unknown, props: Record<string, unknown> = {}) =>
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	render(component as any, { props }).body;

describe('barrel', () => {
	it('exports the components', () => {
		expect(BarrelButton).toBe(Button);
		expect(Field).toBeDefined();
	});
});

describe('Icon', () => {
	it('is hidden from screen readers without a label', () => {
		const out = html(Icon, { name: 'check' });
		expect(out).toContain('aria-hidden="true"');
		expect(out).not.toContain('role="img"');
	});

	it('is announced as an image with a label', () => {
		const out = html(Icon, { name: 'check', label: 'Guardado' });
		expect(out).toContain('role="img"');
		expect(out).toContain('aria-label="Guardado"');
		expect(out).not.toContain('aria-hidden');
	});

	it('uses 20px by default, 16px for sm, and the 1.75 stroke', () => {
		expect(html(Icon, { name: 'plus' })).toMatch(/width="20"/);
		expect(html(Icon, { name: 'plus', size: 'sm' })).toMatch(/width="16"/);
		expect(html(Icon, { name: 'plus' })).toContain('stroke-width="1.75"');
	});

	it.each(ICON_NAMES)('renders %s', (name) => {
		expect(html(Icon, { name })).toContain('<svg');
	});
});

describe('Button', () => {
	it('is a type=button secondary md button by default', () => {
		const out = html(ButtonHarness);
		expect(out).toContain('<button');
		expect(out).toContain('type="button"');
		expect(out).toContain('h-control-md');
		expect(out).toContain('Guardar cambios');
		expect(out).not.toContain('aria-busy');
	});

	it('applies variant and size', () => {
		const out = html(ButtonHarness, { variant: 'primary', size: 'lg', block: true });
		expect(out).toContain('bg-primary');
		expect(out).toContain('h-control-lg');
		expect(out).toContain('w-full');
	});

	it('keeps the variant color and sets aria-busy while loading', () => {
		const out = html(ButtonHarness, { variant: 'danger', loading: true });
		expect(out).toContain('aria-busy="true"');
		expect(out).toContain('aria-disabled="true"');
		expect(out).toContain('bg-danger');
		expect(out).not.toContain('bg-surface-sunken!');
		expect(out).toContain('animate-spin');
		// Label stays in the layout (invisible) so the width does not change.
		expect(out).toContain('invisible');
		expect(out).toContain('Guardar cambios');
	});

	it('uses the disabled attribute and flat look when disabled', () => {
		const out = html(ButtonHarness, { disabled: true });
		expect(out).toMatch(/<button[^>]*\sdisabled/);
		expect(out).toContain('cursor-not-allowed');
	});

	it('passes form attributes through', () => {
		const out = html(ButtonHarness, { type: 'submit', name: 'intent', value: 'save' });
		expect(out).toContain('type="submit"');
		expect(out).toContain('name="intent"');
		expect(out).toContain('value="save"');
	});

	it('renders a link with href', () => {
		const out = html(ButtonHarness, { href: '/campaigns', variant: 'primary' });
		expect(out).toContain('<a');
		expect(out).toContain('href="/campaigns"');
		expect(out).not.toContain('<button');
	});

	it('drops href and marks a loading link as disabled', () => {
		const out = html(ButtonHarness, { href: '/x', loading: true });
		expect(out).not.toContain('href=');
		expect(out).toContain('aria-disabled="true"');
		expect(out).toContain('aria-busy="true"');
	});

	it('makes a square icon-only button', () => {
		const out = html(Button, { icon: 'plus', 'aria-label': 'Agregar' });
		expect(out).toContain('w-control-md');
		expect(out).toContain('aria-label="Agregar"');
	});
});

describe('Field wiring', () => {
	it.each(['text', 'select', 'textarea', 'checkbox'] as const)(
		'links label, hint and error to a %s',
		(control) => {
			const out = html(FieldHarness, {
				control,
				hint: 'Como figura en el DNI',
				error: 'Ingresar el nombre.'
			});
			expect(out).toContain('<label for="f1"');
			expect(out).toMatch(/<(input|select|textarea)[^>]*\sid="f1"/);
			expect(out).toContain('aria-invalid="true"');
			expect(out).toContain('aria-describedby="f1-hint f1-error"');
			expect(out).toContain('id="f1-hint"');
			expect(out).toContain('id="f1-error"');
			expect(out).toContain('Ingresar el nombre.');
		}
	);

	it('has no invalid state or describedby without hint or error', () => {
		const out = html(FieldHarness, { control: 'text' });
		expect(out).not.toMatch(/\saria-invalid=/);
		expect(out).not.toContain('aria-describedby');
	});

	it('describes by the hint only when there is no error', () => {
		const out = html(FieldHarness, { control: 'text', hint: 'Ayuda' });
		expect(out).toContain('aria-describedby="f1-hint"');
		expect(out).not.toMatch(/\saria-invalid=/);
	});

	it('adds (opcional)', () => {
		expect(html(FieldHarness, { control: 'text', optional: true })).toContain('(opcional)');
	});

	it.each(['text', 'select', 'textarea', 'checkbox'] as const)(
		'passes the native required attribute to a %s',
		(control) => {
			const out = html(FieldHarness, { control, required: true });
			expect(out).toMatch(/<(input|select|textarea)[^>]*\srequired/);
		}
	);

	it('does not nest labels around a Checkbox inside a Field', () => {
		const out = html(FieldHarness, { control: 'checkbox', hint: 'Ayuda' });
		expect(out.match(/<label/g)).toHaveLength(1);
		expect(out).toContain('type="checkbox"');
	});

	it('generates an id when none is given', () => {
		const out = html(FieldHarness, { control: 'text' });
		expect(out).toContain('for="f1"');
	});
});

describe('TextInput', () => {
	it('is 16px / 40px with the form name and value', () => {
		const out = html(TextInput, { name: 'code', value: 'A-1' });
		expect(out).toContain('name="code"');
		expect(out).toContain('value="A-1"');
		expect(out).toContain('min-h-control-md');
		expect(out).toContain('text-input');
		expect(out).toContain('pointer-coarse:min-h-touch');
	});

	it('supports prefix and mono', () => {
		const out = html(TextInput, { prefix: '$', mono: true });
		expect(out).toContain('>$</span>');
		expect(out).toContain('pl-9');
		expect(out).toContain('font-mono');
	});

	it('supports invalid outside a Field', () => {
		expect(html(TextInput, { invalid: true })).toContain('aria-invalid="true"');
	});

	it('keeps readonly and disabled', () => {
		const out = html(TextInput, { readonly: true, disabled: true });
		expect(out).toContain('readonly');
		expect(out).toContain('disabled');
	});
});

describe('Select', () => {
	it('renders string and object options with a placeholder', () => {
		const out = html(Select, {
			name: 'type',
			placeholder: 'Elegir…',
			options: ['Uno', { value: 'dos', label: 'Dos', disabled: true }]
		});
		expect(out).toContain('name="type"');
		expect(out).toMatch(/<option value="" disabled[^>]*>Elegir…<\/option>/);
		expect(out).toContain('<option value="Uno">Uno</option>');
		expect(out).toMatch(/<option value="dos" disabled[^>]*>Dos<\/option>/);
	});

	it('selects the given value', () => {
		const out = html(Select, { options: ['a', 'b'], value: 'b' });
		expect(out).toMatch(/<option value="b" selected/);
	});
});

describe('Checkbox', () => {
	it('wraps the control in a label with a described description', () => {
		const out = html(Checkbox, {
			name: 'confirm',
			label: 'Confirmo',
			description: 'Esta acción no se puede deshacer',
			checked: true
		});
		expect(out).toContain('<label');
		expect(out).toContain('type="checkbox"');
		expect(out).toContain('name="confirm"');
		expect(out).toMatch(/\schecked=""/);
		expect(out).toContain('Confirmo');
		const descId = /aria-describedby="([^"]+)"/.exec(out)?.[1];
		expect(descId).toBeTruthy();
		expect(out).toContain(`id="${descId}"`);
	});

	it('has no describedby without description', () => {
		expect(html(Checkbox, { label: 'Enviar comprobante' })).not.toContain('aria-describedby');
	});

	it('disables', () => {
		const out = html(Checkbox, { label: 'x', disabled: true });
		expect(out).toContain('disabled');
		expect(out).toContain('cursor-not-allowed');
	});
});

describe('RadioGroup', () => {
	const options = [
		{ value: 'a', label: 'Opción A', description: 'Detalle A' },
		{ value: 'b', label: 'Opción B' },
		{ value: 'c', label: 'Opción C', disabled: true }
	];

	it('is a fieldset with a legend and one shared name (arrow-key navigation)', () => {
		const out = html(RadioGroup, { legend: 'Medio de pago', options, name: 'method' });
		expect(out).toContain('<fieldset');
		expect(out).toContain('<legend');
		expect(out).toContain('Medio de pago');
		expect(out.match(/type="radio"/g)).toHaveLength(3);
		expect(out.match(/name="method"/g)).toHaveLength(3);
	});

	it('generates a shared name when none is given', () => {
		const out = html(RadioGroup, { legend: 'L', options });
		const names = [...out.matchAll(/name="([^"]+)"/g)].map((m) => m[1]);
		expect(names).toHaveLength(3);
		expect(new Set(names).size).toBe(1);
	});

	it('checks the value and the default value', () => {
		const withValue = html(RadioGroup, { legend: 'L', options, value: 'b' });
		expect(withValue.match(/\schecked=""/g)).toHaveLength(1);
		expect(withValue).toMatch(/value="b"[^>]*\schecked=""|\schecked=""[^>]*value="b"/);
		const withDefault = html(RadioGroup, { legend: 'L', options, defaultValue: 'a' });
		expect(withDefault).toMatch(/value="a"[^>]*\schecked=""|\schecked=""[^>]*value="a"/);
	});

	it('disables single options and the whole group', () => {
		const single = html(RadioGroup, { legend: 'L', options });
		expect(single).toMatch(/value="c"[^>]*disabled|disabled[^>]*value="c"/);
		expect(single).not.toMatch(/<fieldset[^>]*disabled/);
		expect(html(RadioGroup, { legend: 'L', options, disabled: true })).toMatch(
			/<fieldset[^>]*disabled/
		);
	});

	it('links descriptions and the group error', () => {
		const out = html(RadioGroup, { legend: 'L', options, error: 'Elegir una opción.' });
		expect(out).toContain('Detalle A');
		expect(out).toMatch(/aria-describedby="[^"]+-a-desc"/);
		expect(out).toMatch(/<fieldset[^>]*aria-describedby="[^"]+-error"/);
		expect(out).toContain('Elegir una opción.');
	});
});
