// Макет: валидация и имитация отправки. Реальной отправки пока нет.
(function () {
  const form = document.getElementById("reg-form");
  const done = document.getElementById("done");
  const submit = form.querySelector(".submit");
  const genderHint = document.getElementById("gender-hint");

  const REQUIRED = "Это обязательный вопрос";

  function setError(name, message) {
    const field = form.querySelector('[data-field="' + name + '"]');
    field.classList.toggle("is-invalid", Boolean(message));
    field.querySelector(".field__error").textContent = message || "";
  }

  function values() {
    const checked = form.querySelector('input[name="gender"]:checked');
    return {
      telegram: form.telegram.value.trim().replace(/^@/, ""),
      gender: checked ? checked.value : "",
      payment: form.payment.value.trim(),
    };
  }

  function validate() {
    const v = values();
    const errors = {
      telegram: v.telegram ? "" : REQUIRED,
      gender: v.gender ? "" : REQUIRED,
      payment: v.payment ? "" : REQUIRED,
    };
    Object.keys(errors).forEach((k) => setError(k, errors[k]));
    return Object.keys(errors).find((k) => errors[k]);
  }

  form.addEventListener("input", (e) => {
    if (e.target.name) setError(e.target.name === "gender" ? "gender" : e.target.name, "");
  });

  form.addEventListener("change", (e) => {
    if (e.target.name === "gender") {
      genderHint.hidden = e.target.value !== "Ж";
      setError("gender", "");
    }
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const firstInvalid = validate();
    if (firstInvalid) {
      const el = form.querySelector('[name="' + firstInvalid + '"]');
      el.focus();
      return;
    }
    submit.classList.add("is-loading");
    submit.disabled = true;
    setTimeout(() => {
      submit.classList.remove("is-loading");
      submit.disabled = false;
      form.hidden = true;
      done.hidden = false;
      done.focus();
    }, 700);
  });

  document.getElementById("again").addEventListener("click", () => {
    form.reset();
    genderHint.hidden = true;
    done.hidden = true;
    form.hidden = false;
    form.telegram.focus();
  });

  const phoneBtn = document.getElementById("copy-phone");
  const hint = document.getElementById("copy-hint");
  phoneBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(phoneBtn.dataset.phone);
      hint.textContent = "Скопировано ✓";
    } catch (err) {
      hint.textContent = phoneBtn.dataset.phone;
    }
    setTimeout(() => (hint.textContent = "Тимур · нажми, чтобы скопировать"), 2000);
  });
})();
