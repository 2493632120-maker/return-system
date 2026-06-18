// ─── 初始化 ─────────────────────────────────────────────
let editingId = null;

document.addEventListener('DOMContentLoaded', () => {
  loadCarriers();
  loadList();

  // 常见原因快捷按钮
  document.querySelectorAll('.chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const ta = document.getElementById('reason');
      const val = btn.dataset.reason;
      ta.value = ta.value ? ta.value + '；' + val : val;
      ta.focus();
    });
  });

  // 查询物流按钮
  document.getElementById('queryBtn').addEventListener('click', handleQuery);

  // 提交表单
  document.getElementById('returnForm').addEventListener('submit', handleSubmit);

  // 重置表单清除编辑状态
  document.querySelector('button[type="reset"]').addEventListener('click', () => {
    editingId = null;
  });
});

// ─── 加载承运商列表 ───────────────────────────────────
async function loadCarriers() {
  try {
    const resp = await fetch('/api/carriers');
    const list = await resp.json();
    const sel = document.getElementById('carrier');
    sel.innerHTML = '<option value="">— 选择快递公司 —</option>';
    // 常用置顶
    const tops = ['shunfeng','shentong','yuantong','zhongtong','yunda','jingdong','ems'];
    tops.forEach(code => {
      const c = list.find(x => x.code === code);
      if (c) sel.innerHTML += `<option value="${c.code}">📦 ${c.name}</option>`;
    });
    sel.innerHTML += `<option disabled>──────────</option>`;
    list.forEach(c => {
      if (!tops.includes(c.code)) sel.innerHTML += `<option value="${c.code}">${c.name}</option>`;
    });
  } catch (e) {
    console.error('加载承运商失败', e);
  }
}

// ─── 查询物流 ─────────────────────────────────────────
async function handleQuery() {
  const carrier = document.getElementById('carrier').value;
  const trackingNo = document.getElementById('trackingNo').value.trim();
  if (!carrier || !trackingNo) return alert('请先选择快递公司并填入运单号');

  showLogisticsModal(carrier, trackingNo);
}

async function showLogisticsModal(carrier, trackingNo) {
  const overlay = document.getElementById('logisticsModal');
  const body = document.getElementById('logisticsBody');
  overlay.classList.add("show");
  body.innerHTML = `<div class="logistics-loading">🔍 正在查询物流...</div>`;

  try {
    const resp = await fetch(`/api/logistics/${carrier}/${trackingNo}`);
    const data = await resp.json();

    if (data.error || !data.updates || data.updates.length === 0) {
      body.innerHTML = `<div class="logistics-error">❌ ${data.error || '暂末查询到物流信息'}</div>`;
      return;
    }

    let html = `
      <div class="logistics-info">
        <div class="info-item"><div class="info-label">快递公司</div><div class="info-value">${data.carrier}</div></div>
        <div class="info-item"><div class="info-label">运单号</div><div class="info-value">${data.trackingNo}</div></div>
        <div class="info-item"><div class="info-label">状态</div><div class="info-value">${data.statusText}</div></div>
      </div>
      <div class="timeline">
    `;
    data.updates.forEach(item => {
      html += `
        <div class="timeline-item">
          <div class="timeline-time">${item.time}</div>
          <div class="timeline-context">${item.context}</div>
          ${item.location ? `<div class="timeline-location">📍 ${item.location}</div>` : ''}
        </div>
      `;
    });
    html += '</div>';
    body.innerHTML = html;
  } catch (e) {
    body.innerHTML = `<div class="logistics-error">❌ 查询异常，请稍后重试</div>`;
  }
}

function closeLogistics() {
  document.getElementById("logisticsModal").classList.remove("show");
}

// 点击遮罩层关闭
document.getElementById('logisticsModal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeLogistics();
});

// ─── 提交表单 ─────────────────────────────────────────
async function handleSubmit(e) {
  e.preventDefault();
  const data = {
    order_id: document.getElementById('orderId').value.trim(),
    customer: document.getElementById('customer').value.trim(),
    type: document.querySelector('input[name="type"]:checked').value,
    carrier: document.getElementById('carrier').value,
    tracking_no: document.getElementById('trackingNo').value.trim(),
    reason: document.getElementById('reason').value.trim(),
    note: document.getElementById('note').value.trim(),
  };

  if (!data.order_id) return alert('订单号不能为空');

  let resp;
  try {
    if (editingId) {
      resp = await fetch(`/api/returns/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    } else {
      resp = await fetch('/api/returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    }
    const result = await resp.json();
    if (!result.ok && result.error) return alert(result.error);
    resetForm();
    loadList();
  } catch (e) {
    alert('提交失败，请检查网络');
  }
}

function resetForm() {
  editingId = null;
  document.getElementById('returnForm').reset();
  document.getElementById('orderId').focus();
}

// ─── 加载列表 ─────────────────────────────────────────
async function loadList() {
  try {
    const resp = await fetch('/api/returns');
    let list = await resp.json();
    const filter = document.getElementById('filterStatus').value;
    if (filter) list = list.filter(x => x.status === filter);
    renderTable(list);
    document.getElementById('countBadge').textContent = `${list.length} 条`;
  } catch (e) {
    console.error('加载列表失败', e);
  }
}

function renderTable(list) {
  const tbody = document.getElementById('tableBody');
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">暂无数据</td></tr>';
    return;
  }
  const statusMap = { pending: '待处理', received: '已收到', completed: '已完成', cancelled: '已取消' };
  const typeMap = { exchange: '🔄 换货', refund: '💰 退货退款' };

  tbody.innerHTML = list.map(item => {
    const carrierName = document.getElementById('carrier').querySelector(`option[value="${item.carrier}"]`);
    const carrierLabel = carrierName ? carrierName.textContent : (item.carrier || '—');
    return `
      <tr>
        <td>${item.id}</td>
        <td><strong>${item.order_id}</strong></td>
        <td>${typeMap[item.type] || item.type}</td>
        <td>${carrierLabel}</td>
        <td>
          ${item.tracking_no ? `<a href="javascript:void(0)" onclick="showLogisticsModal('${item.carrier}','${item.tracking_no}')" class="track-link">🔍 ${item.tracking_no}</a>` : '—'}
        </td>
        <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${item.reason}">${item.reason || '—'}</td>
        <td><span class="badge status-${item.status}">${statusMap[item.status] || item.status}</span></td>
        <td style="white-space:nowrap">${item.created_at}</td>
        <td>
          <div class="action-group">
            <button class="btn btn-sm btn-outline" onclick="editItem(${item.id})">✏️ 编辑</button>
            <select class="status-select" onchange="updateStatus(${item.id}, this.value)">
              <option value="">状态</option>
              <option value="pending">待处理</option>
              <option value="received">已收到</option>
              <option value="completed">已完成</option>
              <option value="cancelled">已取消</option>
            </select>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// ─── 编辑 ─────────────────────────────────────────────
async function editItem(id) {
  try {
    const resp = await fetch('/api/returns');
    const list = await resp.json();
    const item = list.find(x => x.id === id);
    if (!item) return alert('未找到该记录');

    editingId = id;
    document.getElementById('orderId').value = item.order_id;
    document.getElementById('customer').value = item.customer;
    document.querySelector(`input[name="type"][value="${item.type}"]`).checked = true;
    document.getElementById('carrier').value = item.carrier;
    document.getElementById('trackingNo').value = item.tracking_no;
    document.getElementById('reason').value = item.reason;
    document.getElementById('note').value = item.note;

    // 滚动到表单
    document.getElementById('formPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('orderId').focus();
  } catch (e) {
    alert('加载数据失败');
  }
}

// ─── 更新状态 ─────────────────────────────────────────
async function updateStatus(id, status) {
  if (!status) return;
  if (!confirm(`确定将该单状态改为「${status}」吗？`)) return;

  try {
    const resp = await fetch(`/api/returns/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const result = await resp.json();
    if (result.ok) loadList();
  } catch (e) {
    alert('更新失败');
  }
}

// ─── 批量查询物流（列表里所有有运单号的）───────────────
async function trackAllVisible() {
  const links = document.querySelectorAll('.track-link');
  if (links.length === 0) return alert('列表中没有可查询的运单');
  // 查询第一个
  links[0].click();
}
