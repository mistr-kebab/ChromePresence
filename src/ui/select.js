const nativeValue = Object.getOwnPropertyDescriptor(
  HTMLSelectElement.prototype,
  'value',
);

let uid = 0;

function enhance(select) {
  const id = select.id || `select-${uid}`;
  const n = uid++;
  const buttonId = `${id}-button`;
  const listId = `${id}-list`;

  const wrapper = document.createElement('div');
  wrapper.className = 'dselect';

  const button = document.createElement('button');
  button.type = 'button';
  button.id = buttonId;
  button.className = 'dselect-button';
  button.setAttribute('role', 'combobox');
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', listId);

  const label = document.createElement('span');
  label.className = 'dselect-label';
  const chevron = document.createElement('span');
  chevron.className = 'dselect-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  button.append(label, chevron);

  const list = document.createElement('ul');
  list.id = listId;
  list.className = 'dselect-list';
  list.setAttribute('role', 'listbox');
  list.tabIndex = -1;
  list.hidden = true;

  select.classList.add('select-native');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  select.parentNode.insertBefore(wrapper, select);
  wrapper.append(select, button, list);

  const external = document.querySelector(`label[for="${select.id}"]`);
  if (external) external.htmlFor = buttonId;

  let items = [];
  let activeIndex = -1;

  const selectedIndex = () => Math.max(0, select.selectedIndex);

  const syncLabel = () => {
    const option = select.options[select.selectedIndex];
    label.textContent = option ? option.textContent : '';
    for (const [index, item] of items.entries()) {
      item.setAttribute('aria-selected', String(index === select.selectedIndex));
    }
  };

  const build = () => {
    list.replaceChildren();
    items = [...select.options].map((option, index) => {
      const item = document.createElement('li');
      item.className = 'dselect-option';
      item.id = `${listId}-${n}-${index}`;
      item.setAttribute('role', 'option');
      item.dataset.index = String(index);
      const text = document.createElement('span');
      text.textContent = option.textContent;
      item.append(text);
      list.append(item);
      return item;
    });
    syncLabel();
  };

  const setActive = (index) => {
    activeIndex = Math.min(Math.max(index, 0), items.length - 1);
    for (const [i, item] of items.entries()) {
      item.classList.toggle('is-active', i === activeIndex);
    }
    const active = items[activeIndex];
    if (active) {
      button.setAttribute('aria-activedescendant', active.id);
      active.scrollIntoView({ block: 'nearest' });
    }
  };

  const isOpen = () => !list.hidden;

  const open = () => {
    if (isOpen() || select.disabled) return;
    list.hidden = false;
    const rect = button.getBoundingClientRect();
    const room = window.innerHeight - rect.bottom;
    list.classList.toggle('is-up', room < 300 && rect.top > room);
    button.setAttribute('aria-expanded', 'true');
    setActive(selectedIndex());
  };

  const close = (focus = false) => {
    if (!isOpen()) return;
    list.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    button.removeAttribute('aria-activedescendant');
    if (focus) button.focus();
  };

  const choose = (index) => {
    if (index < 0 || index >= items.length) return;
    if (select.selectedIndex !== index) {
      select.selectedIndex = index;
      syncLabel();
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    close(true);
  };

  button.addEventListener('click', () => (isOpen() ? close() : open()));

  button.addEventListener('keydown', (event) => {
    const { key } = event;
    if (!isOpen()) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(key)) {
        event.preventDefault();
        open();
      }
      return;
    }
    if (key === 'ArrowDown') {
      event.preventDefault();
      setActive(activeIndex + 1);
    } else if (key === 'ArrowUp') {
      event.preventDefault();
      setActive(activeIndex - 1);
    } else if (key === 'Home') {
      event.preventDefault();
      setActive(0);
    } else if (key === 'End') {
      event.preventDefault();
      setActive(items.length - 1);
    } else if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      choose(activeIndex);
    } else if (key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (key === 'Tab') {
      close();
    }
  });

  list.addEventListener('mousemove', (event) => {
    const item = event.target.closest('.dselect-option');
    if (item) setActive(Number(item.dataset.index));
  });

  list.addEventListener('mousedown', (event) => event.preventDefault());

  list.addEventListener('click', (event) => {
    const item = event.target.closest('.dselect-option');
    if (item) choose(Number(item.dataset.index));
  });

  document.addEventListener('pointerdown', (event) => {
    if (!wrapper.contains(event.target)) close();
  });

  button.addEventListener('blur', () => {
    if (isOpen() && !wrapper.contains(document.activeElement)) close();
  });

  Object.defineProperty(select, 'value', {
    configurable: true,
    get() {
      return nativeValue.get.call(this);
    },
    set(value) {
      nativeValue.set.call(this, value);
      syncLabel();
    },
  });

  build();
}

for (const select of document.querySelectorAll('select.select')) {
  enhance(select);
}
