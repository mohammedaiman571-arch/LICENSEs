const baseNetworkInput = document.getElementById('baseNetwork');
const baseError = document.getElementById('baseError');
const deptList = document.getElementById('deptList');
const addDeptBtn = document.getElementById('addDeptBtn');
const calcBtn = document.getElementById('calcBtn');
const globalError = document.getElementById('globalError');
const outputSection = document.getElementById('outputSection');
const outputBody = document.getElementById('outputBody');
const downloadBtn = document.getElementById('downloadBtn');

let lastAllocations = [];

let deptCount = 0;

// ---------- IP helpers ----------

function isValidIP(ip) {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return false;
  return parts.every(p => {
    if (!/^\d{1,3}$/.test(p)) return false;
    const n = Number(p);
    return n >= 0 && n <= 255;
  });
}

function ipToInt(ip) {
  return ip.trim().split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function intToIp(int) {
  return [
    (int >>> 24) & 255,
    (int >>> 16) & 255,
    (int >>> 8) & 255,
    int & 255,
  ].join('.');
}

function maskFromCidr(cidr) {
  if (cidr === 0) return 0;
  return (0xFFFFFFFF << (32 - cidr)) >>> 0;
}

function parseBaseNetwork(value) {
  const trimmed = value.trim();
  const slashParts = trimmed.split('/');
  if (slashParts.length !== 2) {
    return { error: 'Format venum: 192.168.10.1/24 madhiri' };
  }
  const [ipPart, cidrPart] = slashParts;
  if (!isValidIP(ipPart)) {
    return { error: 'Invalid IP address' };
  }
  const cidr = Number(cidrPart);
  if (Number.isNaN(cidr) || cidr < 0 || cidr > 32) {
    return { error: 'Prefix 0-32 kulla irukanum' };
  }
  const ipInt = ipToInt(ipPart);
  const maskInt = maskFromCidr(cidr);
  const networkInt = (ipInt & maskInt) >>> 0;
  const totalAddresses = Math.pow(2, 32 - cidr);
  return { networkInt, cidr, totalAddresses };
}

// Smallest prefix that fits `usersNeeded` usable hosts (+2 for network/broadcast)
function prefixForUsers(usersNeeded) {
  for (let cidr = 30; cidr >= 0; cidr--) {
    const total = Math.pow(2, 32 - cidr);
    const usable = total - 2;
    if (usable >= usersNeeded) return cidr;
  }
  return 0;
}

// ---------- Department rows ----------

function buildDeptRow(id, name, users) {
  const row = document.createElement('div');
  row.className = 'dept-row';
  row.dataset.id = id;
  row.innerHTML = `
    <input class="deptName" type="text" value="${name}" placeholder="eg: HR" spellcheck="false" autocomplete="off">
    <input class="deptUsers" type="number" min="1" value="${users}">
    <button class="removeDeptBtn" type="button" title="Remove">✕</button>
  `;
  return row;
}

function addDept(name = '', users = '') {
  deptCount += 1;
  const row = buildDeptRow(deptCount, name, users);
  deptList.appendChild(row);
  row.querySelector('.removeDeptBtn').addEventListener('click', () => {
    row.remove();
    updateRemoveButtons();
  });
  updateRemoveButtons();
}

function updateRemoveButtons() {
  const rows = deptList.querySelectorAll('.dept-row');
  rows.forEach(row => {
    row.querySelector('.removeDeptBtn').hidden = rows.length <= 1;
  });
}

addDeptBtn.addEventListener('click', () => addDept());

// ---------- Calculation ----------

function clearErrors() {
  baseError.hidden = true;
  globalError.hidden = true;
}

function showBaseError(msg) {
  baseError.hidden = false;
  baseError.textContent = msg;
}

function showGlobalError(msg) {
  globalError.hidden = false;
  globalError.textContent = msg;
}

function calculate() {
  clearErrors();
  outputSection.hidden = true;
  outputBody.innerHTML = '';

  const base = parseBaseNetwork(baseNetworkInput.value);
  if (base.error) {
    showBaseError(base.error);
    return;
  }

  const rows = Array.from(deptList.querySelectorAll('.dept-row'));
  if (rows.length === 0) {
    showGlobalError('Konjam department add pannunga');
    return;
  }

  const depts = [];
  for (const row of rows) {
    const name = row.querySelector('.deptName').value.trim();
    const usersStr = row.querySelector('.deptUsers').value;
    const users = Number(usersStr);

    if (!name) {
      showGlobalError('Ella department kum peru kudunga');
      return;
    }
    if (Number.isNaN(users) || users < 1) {
      showGlobalError(`"${name}" ku valid user count kudunga`);
      return;
    }
    depts.push({ name, users });
  }

  // VLSM: allocate biggest need first, then keep original order for display
  const withIndex = depts.map((d, i) => ({ ...d, originalIndex: i }));
  const sorted = [...withIndex].sort((a, b) => b.users - a.users);

  let cursor = base.networkInt;
  const baseEnd = base.networkInt + base.totalAddresses;
  const allocations = [];

  for (const dept of sorted) {
    const cidr = prefixForUsers(dept.users);
    const blockSize = Math.pow(2, 32 - cidr);

    // Align cursor to a boundary for this block size
    if (cursor % blockSize !== 0) {
      cursor += blockSize - (cursor % blockSize);
    }

    if (cursor + blockSize > baseEnd) {
      showGlobalError(`"${dept.name}" ku space pothum illa base network la. Konjam departments kammi pannunga illa base network periya CIDR ah maathunga.`);
      return;
    }

    const networkInt = cursor;
    const maskInt = maskFromCidr(cidr);
    const broadcastInt = (networkInt | (~maskInt >>> 0)) >>> 0;
    const totalAddresses = blockSize;

    let usableHosts, firstHost, lastHost;
    if (cidr >= 31) {
      usableHosts = cidr === 32 ? 1 : 2;
      firstHost = networkInt;
      lastHost = broadcastInt;
    } else {
      usableHosts = totalAddresses - 2;
      firstHost = networkInt + 1;
      lastHost = broadcastInt - 1;
    }

    const wildcardInt = (~maskInt) >>> 0;

    allocations.push({
      originalIndex: dept.originalIndex,
      networkInt,
      name: dept.name,
      users: dept.users,
      network: intToIp(networkInt),
      cidr,
      mask: intToIp(maskInt),
      wildcard: intToIp(wildcardInt),
      total: totalAddresses,
      broadcast: intToIp(broadcastInt),
      first: intToIp(firstHost),
      last: intToIp(lastHost),
      range: `${intToIp(firstHost)} – ${intToIp(lastHost)}`,
      usableHosts,
      wasted: usableHosts - dept.users,
    });

    cursor += blockSize;
  }

  // Show allocations in address order (0 upward) so the network column reads sequentially
  allocations.sort((a, b) => a.networkInt - b.networkInt);
  lastAllocations = allocations;

  allocations.forEach((a, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="rownum">${i + 1}</td>
      <td>${a.name}</td>
      <td class="mono">${a.network}</td>
      <td class="mono">/${a.cidr}</td>
      <td class="mono">${a.mask}</td>
      <td class="mono">${a.wildcard}</td>
      <td>${a.total.toLocaleString()}</td>
      <td>${a.usableHosts.toLocaleString()}</td>
      <td class="mono">${a.first}</td>
      <td class="mono">${a.last}</td>
      <td class="mono">${a.broadcast}</td>
      <td>${a.wasted.toLocaleString()}</td>
    `;
    outputBody.appendChild(tr);
  });

  outputSection.hidden = false;
}

calcBtn.addEventListener('click', calculate);

function downloadExcel() {
  if (!lastAllocations.length) return;

  const rows = lastAllocations.map((a, i) => ({
    '#': i + 1,
    'Name': a.name,
    'Network': a.network,
    'CIDR': `/${a.cidr}`,
    'Mask': a.mask,
    'Wildcard': a.wildcard,
    'Total': a.total,
    'Usable': a.usableHosts,
    'First': a.first,
    'Last': a.last,
    'Broadcast': a.broadcast,
    'Wasted': a.wasted,
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet['!cols'] = [
    { wch: 4 }, { wch: 14 }, { wch: 16 }, { wch: 6 },
    { wch: 16 }, { wch: 16 }, { wch: 10 }, { wch: 10 },
    { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 10 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'VLSM Allocation');

  const baseValue = baseNetworkInput.value.trim().replace(/[\/.]/g, '_');
  XLSX.writeFile(workbook, `vlsm-allocation-${baseValue || 'output'}.xlsx`);
}

downloadBtn.addEventListener('click', downloadExcel);

// Start with two sample departments
addDept('HR', 20);
addDept('Sales', 50);
