const menuButton = document.querySelector('.menu-btn');
const nav = document.querySelector('.nav-links');
menuButton?.addEventListener('click', () => {
  const open = nav.classList.toggle('open');
  menuButton.setAttribute('aria-expanded', String(open));
});

document.querySelectorAll('.nav-links a').forEach(link => link.addEventListener('click', () => {
  nav?.classList.remove('open');
  menuButton?.setAttribute('aria-expanded', 'false');
}));

document.querySelectorAll('[data-show-if]').forEach(block => {
  const [name, value] = block.dataset.showIf.split(':');
  const inputs = document.querySelectorAll(`[name="${name}"]`);
  const update = () => {
    const selected = document.querySelector(`[name="${name}"]:checked`)?.value;
    const visible = selected === value;
    block.hidden = !visible;
    block.querySelectorAll('input, select, textarea').forEach(field => {
      if (field.dataset.conditionalRequired === 'true') field.required = visible;
    });
  };
  inputs.forEach(input => input.addEventListener('change', update));
  update();
});

document.querySelectorAll('[data-counter]').forEach(field => {
  const output = document.querySelector(field.dataset.counter);
  const update = () => { if (output) output.textContent = `${field.value.length} caracteres`; };
  field.addEventListener('input', update);
  update();
});

const startDate = document.querySelector('#data-inicio');
if (startDate) {
  const addBusinessDays = (date, days) => {
    const next = new Date(date);
    while (days > 0) {
      next.setDate(next.getDate() + 1);
      if (next.getDay() !== 0 && next.getDay() !== 6) days--;
    }
    return next;
  };
  const min = addBusinessDays(new Date(), 5);
  startDate.min = `${min.getFullYear()}-${String(min.getMonth()+1).padStart(2,'0')}-${String(min.getDate()).padStart(2,'0')}`;
  const hint = document.querySelector('#data-minima');
  if (hint) hint.textContent = min.toLocaleDateString('pt-BR');
}

const form = document.querySelector('#tce-form');
form?.addEventListener('submit', event => {
  const inicio = document.querySelector('#data-inicio');
  const fim = document.querySelector('#data-fim');
  if (inicio?.value && fim?.value && fim.value <= inicio.value) {
    event.preventDefault();
    fim.setCustomValidity('A data de encerramento deve ser posterior à data de início.');
    fim.reportValidity();
  } else {
    fim?.setCustomValidity('');
  }
});
