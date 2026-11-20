import "./admin.css";

const $ = (selector, root = document) => root.querySelector(selector);
const page = $("#page");
const actions = $("#page-actions");
const editor = $("#editor");
const editorForm = $("#editor-form");
const money = (value) => `${Number(value).toLocaleString("en-US")} SYP`;
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const imageUrl = (value) => escape(encodeURI(`/${value.replace(/^\//, "")}`));
const statusLabels = { new: "New", confirmed: "Confirmed", fulfilled: "Fulfilled", cancelled: "Cancelled" };
const options = (choices, current) => choices.map(([value, label]) =>
  `<option value="${escape(value)}"${value === current ? " selected" : ""}>${escape(label)}</option>`).join("");
const date = (value) => value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Unknown date";
const shortId = (id) => id.slice(0, 8).toUpperCase();
const section = {
  orders: ["Orders", "Review incoming orders and keep fulfillment moving."],
  products: ["Products", "Set prices, update images, and choose what appears in the shop."],
  storefront: ["Storefront", "Publish announcements, page introductions, and collection features."],
  assets: ["Images", "Upload and reuse artwork and product photos across the shop."],
};
let pageVersion = 0;
let toastTimer;

function announce(message) {
  const status = $("#app-status");
  status.textContent = message;
  status.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { status.hidden = true; }, 4000);
}

async function api(path, { method = "GET", data, file } = {}) {
  let response;
  try {
    response = await fetch(`/api/admin/${path}`, {
      method,
      headers: data ? { "Content-Type": "application/json" } : {},
      body: data ? JSON.stringify(data) : file,
    });
  } catch {
    throw new Error("Can’t reach the store. Check your connection and try again.");
  }
  if (response.status === 401 && path !== "login") showLogin("Your session ended. Sign in to continue.");
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Something went wrong. Try again.");
  return result;
}

function showLogin(message = "") {
  pageVersion++;
  editor.close();
  $("#studio").hidden = true;
  $("#sign-in").hidden = false;
  $("#login-form .form-error").textContent = message;
  $("#login-form input").focus();
}

function formAction(form, action) {
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (form.getAttribute("aria-busy") === "true") return;
    const button = event.submitter || $("button[type=submit], button.primary", form);
    const error = $(".form-error", form);
    if (error) error.textContent = "";
    form.setAttribute("aria-busy", "true");
    if (button) button.disabled = true;
    try {
      await action(new FormData(form));
    } catch (failure) {
      if (error) error.textContent = failure.message;
      else announce(failure.message);
    } finally {
      form.removeAttribute("aria-busy");
      if (button) button.disabled = false;
    }
  };
}

function edit(title, saveLabel, fields, action, success) {
  $("#editor-title").textContent = title;
  $("#editor-save").textContent = saveLabel;
  $("#editor-save").classList.toggle("danger-button", saveLabel === "Remove image");
  $("#editor-body").innerHTML = fields;
  $(".form-error", editor).textContent = "";
  editor.showModal();
  formAction(editorForm, async (form) => {
    await action(form);
    editor.close();
    announce(success);
    await renderPage();
  });
}

function closeEditor(event) {
  if (editorForm.getAttribute("aria-busy") === "true") event.preventDefault();
  else editor.close();
}
editor.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", closeEditor));
editor.addEventListener("cancel", closeEditor);

function table(headings, rows) {
  return `<div class="table-wrap"><table><thead><tr>${headings.map((heading) =>
    `<th scope="col">${heading}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function orderEditor(order) {
  const { customer } = order;
  const details = [
    ["WhatsApp", customer.whatsapp], ["Call", customer.phone], ["Instagram", customer.instagram],
    ["Pickup / delivery", customer.pickup], ["Notes", customer.notes], ["Imported from", customer.source],
  ].filter(([, value]) => value);
  edit(`Order #${shortId(order.id)}`, "Save status", `
    <div class="fields">
      <div><h3>${escape(customer.name)}</h3><p class="muted">${escape(date(order.created_at))}</p></div>
      <dl class="order-meta">${details.map(([label, value]) => `<dt>${label}</dt><dd>${escape(value)}</dd>`).join("")}</dl>
      <ul class="order-lines">${order.items.map((item) =>
        `<li><span>${escape(item.name)} × ${item.quantity}</span><span>${money(item.subtotal)}</span></li>`).join("")}</ul>
      <p><strong>Total ${money(order.total)}</strong></p>
      <label>Status<select name="status">${options(Object.entries(statusLabels), order.status)}</select></label>
    </div>`, (form) => api("orders", { method: "PATCH", data: {
    id: order.id, revision: order.revision, status: form.get("status"),
  } }), "Order status saved.");
}

const orderFilter = { search: "", status: "", page: 1 };
async function ordersPage(version) {
  const query = new URLSearchParams({ page: orderFilter.page, search: orderFilter.search });
  if (orderFilter.status) query.set("status", orderFilter.status);
  const { rows, more, summary } = await api(`orders?${query}`);
  if (version !== pageVersion) return;
  const counts = [
    ["New orders", summary.new], ["Confirmed", summary.confirmed], ["Fulfilled", summary.fulfilled], ["Fulfilled revenue", money(summary.revenue)],
  ];
  actions.innerHTML = '<button type="button" id="refresh-orders">Refresh orders</button>';
  $("#refresh-orders").onclick = renderPage;
  page.innerHTML = `
    <div class="metrics">${counts.map(([label, value]) =>
      `<div class="metric"><small>${label}</small><strong>${value}</strong></div>`).join("")}</div>
    <section class="panel" aria-label="Order list">
      <form class="filters">
        <label>Find an order<input name="search" type="search" placeholder="Customer name, number, or order ID" maxlength="100" value="${escape(orderFilter.search)}"></label>
        <label>Status<select name="status">${options([["", "All statuses"], ...Object.entries(statusLabels)], orderFilter.status)}</select></label>
        <button>Filter</button>
      </form>
      ${rows.length ? table(["Order", "Customer", "Total", "Status", "Action"], rows.map((order, index) =>
        `<tr><td><strong>#${shortId(order.id)}</strong><small>${escape(date(order.created_at))}</small></td>
          <td>${escape(order.customer.name)}<small>${escape(order.customer.pickup)}</small></td>
          <td>${money(order.total)}</td><td><span class="status ${order.status}">${statusLabels[order.status]}</span></td>
          <td><button type="button" data-order="${index}" aria-label="Open order ${shortId(order.id)}">Open</button></td></tr>`).join(""))
        : `<p class="empty">${orderFilter.search || orderFilter.status ? "No orders match. Try another name or status." : "New orders will appear here as soon as customers check out."}</p>`}
      ${more || orderFilter.page > 1 ? `<div class="pagination">
        <button id="previous" ${orderFilter.page === 1 ? "disabled" : ""}>Previous</button>
        <small>Page ${orderFilter.page}</small>
        <button id="next" ${more ? "" : "disabled"}>Next</button>
      </div>` : ""}
    </section>`;
  formAction($(".filters", page), async (form) => {
    Object.assign(orderFilter, { search: form.get("search").trim(), status: form.get("status"), page: 1 });
    await renderPage();
    $('input[name="search"]', page)?.focus();
  });
  for (const [id, step] of [["previous", -1], ["next", 1]]) {
    const button = $(`#${id}`, page);
    if (button) button.onclick = () => { orderFilter.page += step; renderPage(); };
  }
  page.querySelectorAll("[data-order]").forEach((button) => {
    button.onclick = () => orderEditor(rows[Number(button.dataset.order)]);
  });
}

function imageField(library, current = "", required = false) {
  const entries = [["", required ? "Choose an image" : "No image"], ...library.map((asset) => [asset.url, asset.name])];
  if (current && !entries.some(([url]) => url === current)) entries.splice(1, 0, [current, "Current image"]);
  return `
    <label>Image<select name="image"${required ? " required" : ""}>${options(entries, current)}</select></label>
    <img class="preview-image" alt="" ${current ? `src="${imageUrl(current)}"` : "hidden"}>
    <label>Or upload an image<input type="file" id="inline-upload" accept="image/png,image/jpeg,image/webp,image/gif"><span class="help">JPEG, PNG, WebP or GIF, up to 5 MB.</span></label>`;
}

function uploadImage(file) {
  if (!file?.size) throw new Error("Choose an image to upload.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Choose an image no larger than 5 MB.");
  return api(`assets?name=${encodeURIComponent(file.name)}`, { method: "POST", file });
}

function wireImageField() {
  const select = $('select[name="image"]', editor);
  const preview = $(".preview-image", editor);
  const change = () => {
    preview.hidden = !select.value;
    if (select.value) preview.src = `/${select.value.replace(/^\//, "")}`;
  };
  select.onchange = change;
  $("#inline-upload").onchange = async ({ target }) => {
    if (!target.files.length) return;
    const saveButton = $("#editor-save");
    saveButton.disabled = true;
    $(".form-error", editor).textContent = "";
    try {
      const uploaded = await uploadImage(target.files[0]);
      select.add(new Option(uploaded.name, uploaded.url, false, true));
      change();
    } catch (error) {
      $(".form-error", editor).textContent = error.message;
    } finally {
      saveButton.disabled = false;
      target.value = "";
    }
  };
}

function productEditor(row, navigation, library) {
  const types = navigation.types;
  const variant = [row?.variantColor, row?.variantSide, row?.variantPrint].filter(Boolean).join(" / ");
  edit(row ? "Edit product" : "Add product", row ? "Save product" : "Add product", `
    <div class="fields">
      <label>Product name<input name="name" maxlength="160" value="${escape(row?.name)}" required></label>
      <div class="field-pair">
        <label>Collection<select name="type">${options(types.map(({ id, label }) => [id, label]), row?.type)}</select></label>
        <label id="product-section" hidden>Section<select name="section"></select></label>
      </div>
      <label>Price in SYP<input name="price" type="number" min="0" max="5000000" step="1" value="${escape(row?.price)}" required></label>
      ${imageField(library, row?.image, true)}
      <details ${variant ? "open" : ""}><summary>Variant options</summary>
        <div class="fields">
          <p class="help">Variants with the same product name appear together in the shop.</p>
          <div class="field-pair">
            <label>Shirt color<select name="variantColor">${options([["", "Default"], ["B", "Black"], ["W", "White"], ["BL", "Blue"]], row?.variantColor || "")}</select></label>
            <label>Photo side<select name="variantSide">${options([["", "Auto"], ["front", "Front"], ["back", "Back"]], row?.variantSide || "")}</select></label>
          </div>
          <label>Print color or name<input name="variantPrint" maxlength="50" value="${escape(row?.variantPrint)}"></label>
          <label class="check"><input name="variantDefault" type="checkbox" ${row?.variantDefault ? "checked" : ""}> Show this variant first</label>
        </div>
      </details>
      <label class="check"><input name="published" type="checkbox" ${row?.published ? "checked" : ""}> Show on the storefront</label>
    </div>`, (form) => api("products", { method: row ? "PATCH" : "POST", data: {
    ...Object.fromEntries([...form.entries()].filter(([name]) => !["published", "variantDefault", "price"].includes(name))),
    price: Number(form.get("price")), published: form.has("published"), variantDefault: form.has("variantDefault"),
    defaultSide: row?.defaultSide, ...(row ? { id: row.id, revision: row.revision } : {}),
  } }), row ? "Product saved." : "Product added.");
  const type = $('select[name="type"]', editor);
  const updateSections = () => {
    const sections = types.find(({ id }) => id === type.value).sections;
    $("#product-section").hidden = !sections.length;
    $('select[name="section"]', editor).innerHTML = options(sections.map(({ id, label }) => [id, label]), row?.section);
  };
  type.onchange = updateSections;
  updateSections();
  wireImageField();
}

let productSearch = "";
async function productsPage(version) {
  const [rows, { navigation }, library] = await Promise.all([api("products"), api("storefront"), api("assets")]);
  if (version !== pageVersion) return;
  function open(row) {
    api("assets").then((images) => productEditor(row, navigation, images)).catch((error) => announce(error.message));
  }
  actions.innerHTML = '<button class="primary" id="new-product">Add product</button>';
  $("#new-product").onclick = () => productEditor(null, navigation, library);
  page.innerHTML = `<section class="panel" aria-label="Product list">
    <form class="filters"><label>Find a product<input type="search" name="search" placeholder="Product or collection name" value="${escape(productSearch)}"></label><button>Filter</button></form>
    <div id="product-results"></div>
  </section>`;
  const results = $("#product-results");
  const render = () => {
    const visible = rows.filter((row) => `${row.name} ${row.type} ${row.section || ""}`.toLowerCase().includes(productSearch.toLowerCase()));
    results.innerHTML = visible.length ? table(["Product", "Collection", "Price", "Visibility", "Action"], visible.map((row, index) =>
      `<tr><td><div class="image-cell"><img src="${imageUrl(row.image)}" alt="" loading="lazy">
        <div><strong>${escape(row.name)}</strong><small>${escape([row.variantColor, row.variantSide, row.variantPrint].filter(Boolean).join(" / "))}</small></div></div></td>
        <td>${escape(navigation.types.find((type) => type.id === row.type)?.label || row.type)}</td><td>${money(row.price)}</td>
        <td><span class="status ${row.published ? "published" : ""}">${row.published ? "Published" : "Hidden"}</span></td>
        <td><button type="button" data-product="${index}" aria-label="Edit ${escape(row.name)}">Edit</button></td></tr>`).join(""))
      : '<p class="empty">No products match. Try a different search or add a product.</p>';
    results.querySelectorAll("[data-product]").forEach((button) => {
      button.onclick = () => open(visible[Number(button.dataset.product)]);
    });
  };
  formAction($(".filters", page), async (form) => { productSearch = form.get("search").trim(); render(); });
  render();
}

function collectionEditor(site, library, type, child) {
  const row = child || type;
  const feature = row.feature || {};
  edit(child ? "Edit section" : "Edit collection", "Publish changes", `
    <div class="fields">
      <label>Label<input name="label" value="${escape(row.label)}" maxlength="80" required></label>
      ${child ? `<label class="check"><input name="comingSoon" type="checkbox" ${row.tease ? "checked" : ""}> Show as coming soon</label>
        <label>Feature headline<input name="title" value="${escape(feature.title)}" maxlength="150"></label>
        <label>Dates<input name="dates" value="${escape(feature.dates)}" maxlength="100"></label>
        <label>Feature text<textarea name="copy" rows="5" maxlength="2500">${escape(feature.copy)}</textarea></label>
        ${imageField(library, feature.image)}
        <label>Image description<input name="alt" value="${escape(feature.alt)}" maxlength="160"></label>` : ""}
    </div>`, (form) => api("collections", { method: "PATCH", data: {
    ...Object.fromEntries(form), type: type.id, section: child?.id, revision: site.revision,
    comingSoon: form.has("comingSoon"),
  } }), "Collection changes published.");
  if (child) wireImageField();
}

async function storefrontPage(version) {
  const [site, library] = await Promise.all([api("storefront"), api("assets")]);
  if (version !== pageVersion) return;
  const types = site.navigation.types;
  page.innerHTML = `
    <div class="content-columns">
      <form id="copy-form" class="panel edit-section fields">
        <h2>Shop and pages</h2>
        <label>Shop announcement<textarea name="announcement" rows="2" maxlength="280" placeholder="Leave blank to hide the announcement">${escape(site.copy.announcement)}</textarea></label>
        <label>About Us introduction<textarea name="about" rows="5" maxlength="2000" placeholder="Leave blank to use the original introduction">${escape(site.copy.about)}</textarea></label>
        <label>Observatory introduction<textarea name="observatory" rows="5" maxlength="2000" placeholder="Leave blank to use the original introduction">${escape(site.copy.observatory)}</textarea></label>
        <p class="form-error" role="alert"></p>
        <button class="primary">Publish copy</button>
      </form>
      <section class="panel edit-section" aria-label="Collections">
        <h2>Collections</h2>
        ${types.map((type, index) => `
          <div class="collection-row"><strong>${escape(type.label)}</strong><button data-collection="${index}" aria-label="Edit ${escape(type.label)}">Edit</button></div>
          ${type.sections.map((child, childIndex) => `<div class="collection-row child">
            <span>${escape(child.label)}</span><button data-collection="${index}" data-child="${childIndex}" aria-label="Edit ${escape(child.label)}">Edit</button></div>`).join("")}
        `).join("")}
      </section>
    </div>`;
  formAction($("#copy-form"), async (form) => {
    const saved = await api("storefront", { method: "PATCH", data: { ...Object.fromEntries(form), revision: site.revision } });
    site.revision = saved.revision;
    announce("Storefront copy published.");
  });
  page.querySelectorAll("[data-collection]").forEach((button) => {
    button.onclick = () => {
      const type = types[Number(button.dataset.collection)];
      collectionEditor(site, library, type, type.sections[Number(button.dataset.child)]);
    };
  });
}

async function assetsPage(version) {
  const library = await api("assets");
  if (version !== pageVersion) return;
  page.innerHTML = `
    <section class="panel upload-panel">
      <form><label>Choose an image<input type="file" name="image" accept="image/png,image/jpeg,image/webp,image/gif" required>
        <span class="help">JPEG, PNG, WebP or GIF, up to 5 MB.</span></label>
        <button class="primary">Upload image</button><p class="form-error" role="alert"></p>
      </form>
    </section>
    ${library.length ? `<div class="asset-grid">${library.map((asset, index) => `
      <article class="asset-card">
        <img src="${imageUrl(asset.url)}" alt="" loading="lazy">
        <div><strong>${escape(asset.name)}</strong><br><small>${Math.ceil(asset.size / 1024)} KB</small><br>
          <button data-rename="${index}" aria-label="Rename ${escape(asset.name)}">Rename</button>
          <button class="danger" data-remove="${index}" aria-label="Remove ${escape(asset.name)}">Remove</button></div>
      </article>`).join("")}</div>` : '<p class="panel empty">Upload your first image to use it in products or collection features.</p>'}`;
  formAction($("form", page), async (form) => {
    await uploadImage(form.get("image"));
    announce("Image uploaded.");
    await renderPage();
  });
  page.querySelectorAll("[data-rename], [data-remove]").forEach((button) => {
    button.onclick = () => {
      const asset = library[Number(button.dataset.rename ?? button.dataset.remove)];
      if (button.dataset.rename != null) edit("Rename image", "Save name",
        `<label>Image name<input name="name" maxlength="160" value="${escape(asset.name)}" required></label>`,
        (form) => api(`assets/${asset.id}`, { method: "PATCH", data: { name: form.get("name") } }), "Image renamed.");
      else edit("Remove image", "Remove image",
        `<p>Permanently remove <strong>${escape(asset.name)}</strong>? Images in use can only be removed after you replace them.</p>`,
        () => api(`assets/${asset.id}`, { method: "DELETE" }), "Image removed.");
    };
  });
}

const pages = { orders: ordersPage, products: productsPage, storefront: storefrontPage, assets: assetsPage };
async function renderPage() {
  if ($("#studio").hidden) return;
  const version = ++pageVersion;
  const hash = location.hash.slice(1);
  const tab = Object.hasOwn(pages, hash) ? hash : "orders";
  $("#page-title").textContent = section[tab][0];
  $("#page-description").textContent = section[tab][1];
  $(".rail nav").querySelectorAll("a").forEach((link) => {
    if (link.hash === `#${tab}`) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  actions.replaceChildren();
  page.innerHTML = '<p class="panel empty" role="status">Loading…</p>';
  try {
    await pages[tab](version);
  } catch (error) {
    if (version !== pageVersion) return;
    page.innerHTML = `<div class="panel empty" role="alert"><p>${escape(error.message)}</p><button id="retry">Try again</button></div>`;
    $("#retry").onclick = renderPage;
  }
}

function showStudio() {
  $("#sign-in").hidden = true;
  $("#login-form").reset();
  $("#studio").hidden = false;
  renderPage();
  $("#page-title").focus();
}

formAction($("#login-form"), async (form) => {
  await api("login", { method: "POST", data: { password: form.get("password") } });
  showStudio();
});
$("#logout").onclick = async () => {
  try {
    await api("logout", { method: "POST" });
    page.replaceChildren();
    showLogin();
  } catch (error) { announce(error.message); }
};
window.addEventListener("hashchange", () => {
  renderPage();
  if (!$("#studio").hidden) $("#page-title").focus();
});
api("session").then(showStudio).catch((error) => {
  const message = error.message === "Sign in to open the admin dashboard." ? "" : error.message;
  showLogin(message);
});
