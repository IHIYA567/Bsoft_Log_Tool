(function() {
    'use strict';

    // 1. 数据配置映射
    const DICTS = {
        houseType: { '1': '非住宿', '2': '宿舍', '3': '宾馆' },
        fgWithinContract: { '1': '合同内', '0': '合同外' },
        plan: { '1': '计划内', '2': '计划外' },
        role: { '1': '管理', '2': '销售', '3': '技术', '4': '工程', '5': '服务', '6': '其他', '7': '研发支持' },
        model: { '1': '现场', '2': '远程' },
        category: { '1': '会议', '2': '协调', '3': '上线', '4': '开发', '5': '实施', '6': '培训', '7': '验收', '8': '维护', '9': '其他' },
        result: { '0': '进行中', '1': '已完成' }
    };

    // 默认兜底配置
    let userConfig = {
        auto_run: true, 
        fill_workload: true, workload_val: '8.0',
        fill_travel: true,
        init_delay: 1,
        target_houseType: '3', target_fgWithinContract: '1',
        target_plan: '1', target_role: '4',
        target_model: '1', target_category: '5', target_result: '0'
    };

    let isWorkflowActive = false; // 严格的写权限生命周期锁

    function saveConfig() {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ 'logFillConfig_v7': userConfig });
        }
    }

    // 2. 界面样式
    const style = document.createElement('style');
    style.innerHTML = `
        @keyframes fillFadeIn { from { opacity: 0; transform: translateY(15px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fillFadeOut { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(-15px); } }
        .panel-in { animation: fillFadeIn 0.2s ease-out forwards; }
        .fill-btn-hover { transition: transform 0.2s cubic-bezier(0.2, 0, 0.2, 1), filter 0.2s; }
        .fill-btn-hover:hover { transform: scale(1.05); filter: brightness(1.1); }
        .fill-btn-active { transform: scale(0.9) !important; filter: brightness(0.9) !important; }
        .config-select { width: 100%; padding: 4px 6px; border-radius: 5px; border: 1px solid #ddd; font-size: 12px; background: #fff; cursor: pointer; outline: none; }
        .config-row { display: flex; align-items: center; justify-content: flex-start; margin-bottom: 8px; gap: 15px; }
        .config-label { font-size: 12px; color: #444; font-weight: 600; min-width: 65px; display: flex; align-items: center; gap: 4px; }
        .desc-text { font-size: 11px; color: #666; line-height: 1.4; margin-bottom: 10px; background: #f6f8fa; padding: 8px; border-radius: 6px; border-left: 3px solid #1890ff; }
        .delay-text-badge { background: #1890ff; color: #fff; padding: 1px 5px; border-radius: 4px; font-size: 12px; font-weight: bold; margin: 0 2px; }
        .range-container { width: 100%; padding: 0 4px; box-sizing: border-box; position: relative; }
        .range-input-style { width: 100%; cursor: pointer; accent-color: #1890ff; height: 6px; margin: 8px 0 2px 0; }
        .range-input-style:disabled { accent-color: #bfbfbf; cursor: not-allowed; }
        .matrix-item { display: flex; align-items: center; justify-content: space-between; padding: 4px 8px; border-radius: 4px; background: rgba(0,0,0,0.02); font-size: 11px; font-weight: 600; }
        .range-ticks { display: flex; justify-content: space-between; padding: 0 2px; margin-bottom: 12px; }
        .range-ticks span { font-size: 9px; color: #aaa; position: relative; display: flex; flex-direction: column; align-items: center; }
        .range-ticks span::before { content: ''; width: 1px; height: 4px; background: #ccc; margin-bottom: 2px; }
        .about-btn { background: none; border: none; color: #1890ff; font-size: 12px; font-weight: 600; cursor: pointer; padding: 2px 6px; border-radius: 4px; transition: background 0.2s; }
        .about-btn:hover { background: #e6f7ff; text-decoration: underline; }
    `;
    document.head.appendChild(style);

    function applyStrongFlash(el) { if (!el) return; el.style.transition = 'all 0.3s ease'; el.style.boxShadow = '0 0 12px #52c41a'; setTimeout(() => { el.style.boxShadow = ''; }, 600); }
    function addClickEffect(btn) { btn.addEventListener('mousedown', () => btn.classList.add('fill-btn-active')); const removeEffect = () => btn.classList.remove('fill-btn-active'); btn.addEventListener('mouseup', removeEffect); btn.addEventListener('mouseleave', removeEffect); }

    // 3. 基础组件控制与检测
    function clickButtonByLabelText(labelTitle, targetText, showFlash = true) {
        if (!isWorkflowActive) return null; 
        try {
            const labels = Array.from(document.querySelectorAll('label, span, .ant-form-item-label label, .ant-col-6'));
            const cleanTargetTitle = labelTitle.replace(/\s+/g, '');
            let clickedEl = null;

            labels.forEach(l => {
                const actualLabelText = l.innerText.replace(/\s+/g, '').replace(/[*：:]/g, '');
                if (actualLabelText === cleanTargetTitle || actualLabelText.includes(cleanTargetTitle)) {
                    const container = l.closest('.ant-form-item') || l.closest('.ant-row') || l.parentElement.parentElement;
                    if (container) {
                        const options = Array.from(container.querySelectorAll('.ant-radio-button-wrapper, .ant-radio-wrapper, label.ant-checkbox-wrapper, .ant-btn, button'));
                        options.forEach(opt => {
                            const optText = opt.innerText.trim() || opt.textContent.trim();
                            if (optText === targetText || optText.includes(targetText)) {
                                const isChecked = opt.classList.contains('ant-radio-button-wrapper-checked') || 
                                                  opt.classList.contains('ant-radio-wrapper-checked') || 
                                                  opt.classList.contains('ant-btn-primary') ||
                                                  opt.querySelector('.ant-radio-checked, .ant-checkbox-checked');
                                if (!isChecked) { opt.click(); }
                                clickedEl = opt;
                            }
                        });
                    }
                }
            });
            if (clickedEl && showFlash) applyStrongFlash(clickedEl);
            return clickedEl;
        } catch(e) { return null; }
    }

    function checkItemStatus(labelTitle, targetText) {
        const labels = Array.from(document.querySelectorAll('label, span, .ant-form-item-label label'));
        const cleanTargetTitle = labelTitle.replace(/\s+/g, '');
        let isRealChecked = false;

        labels.forEach(l => {
            const actualLabelText = l.innerText.replace(/\s+/g, '').replace(/[*：:]/g, '');
            if (actualLabelText === cleanTargetTitle || actualLabelText.includes(cleanTargetTitle)) {
                const container = l.closest('.ant-form-item') || l.closest('.ant-row') || l.parentElement.parentElement;
                if (container) {
                    const options = Array.from(container.querySelectorAll('.ant-radio-button-wrapper, .ant-radio-wrapper, label.ant-checkbox-wrapper, .ant-btn, button'));
                    options.forEach(opt => {
                        const optText = opt.innerText.trim() || opt.textContent.trim();
                        if (optText === targetText || optText.includes(targetText)) {
                            if (opt.classList.contains('ant-radio-button-wrapper-checked') || 
                                opt.classList.contains('ant-radio-wrapper-checked') || 
                                opt.classList.contains('ant-btn-primary') ||
                                opt.querySelector('.ant-radio-checked, .ant-checkbox-checked')) {
                                isRealChecked = true;
                            }
                        }
                    });
                }
            }
        });
        return isRealChecked;
    }

    function getTravelInputElement() {
        const allElements = Array.from(document.querySelectorAll('span, label, div'));
        for (let el of allElements) {
            if (el.childNodes.length === 1 && el.innerText.trim() === '是否出差：') {
                let nextEl = el.nextElementSibling;
                if (nextEl && nextEl.tagName.toLowerCase() === 'input') return nextEl;
                if (el.parentElement) {
                    let inputInside = el.parentElement.querySelector('input[type="checkbox"]');
                    if (inputInside) return inputInside;
                }
            }
        }
        return document.querySelector('input[type="checkbox"]');
    }

    function clickTravelCheckbox(shouldCheck, showFlash = true) {
        if (!isWorkflowActive) return false; 
        try {
            const inputEl = getTravelInputElement();
            if (!inputEl) return false;
            if (inputEl.checked !== shouldCheck) {
                inputEl.checked = shouldCheck;
                inputEl.dispatchEvent(new Event('click', { bubbles: true }));
                inputEl.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (showFlash && inputEl.parentElement) applyStrongFlash(inputEl.parentElement);
            return inputEl.checked === shouldCheck;
        } catch(e) { return false; }
    }

    function checkTravelStatus() {
        const inputEl = getTravelInputElement();
        return inputEl ? inputEl.checked : false;
    }

    // 4. 工时高兼容操作组件
    function getWorkloadInput() {
        let correctInput = null;
        const allInputs = document.querySelectorAll('input.ant-input-number-input');
        allInputs.forEach(inp => {
            const parent = inp.closest('.ant-form-item') || inp.parentElement.parentElement;
            if (parent && (parent.innerText.includes('工时') || parent.textContent.includes('时') || parent.innerText.includes('h'))) {
                if (inp.tagName.toLowerCase() === 'input' && inp.type !== 'textarea') { correctInput = inp; }
            }
        });
        if (!correctInput) correctInput = document.querySelector('input[aria-label="工时"]') || document.querySelector('.ant-input-number-input');
        return correctInput;
    }

    function fillWorkloadViaButtons(targetVal, showFlash = true) {
        if (!isWorkflowActive) return false; 
        try {
            const correctInput = getWorkloadInput();
            if (!correctInput) return false;

            correctInput.focus();
            correctInput.select(); 
            document.execCommand('delete', false, null);
            correctInput.value = targetVal; 
            correctInput.dispatchEvent(new Event('input', { bubbles: true }));
            correctInput.dispatchEvent(new Event('change', { bubbles: true }));
            correctInput.blur();
            
            if (showFlash) applyStrongFlash(correctInput.closest('.ant-input-number') || correctInput);
            return true;
        } catch(e) { return false; }
    }

    function checkRealWorkloadStatus() {
        const input = getWorkloadInput();
        if (!input) return false;
        let valStr = input.value || "";
        let ariaVal = input.getAttribute('aria-valuenow') || "";
        let parentText = input.parentElement ? input.parentElement.innerText : "";
        let finalStr = valStr || ariaVal || parentText;
        let match = finalStr.match(/[\d.]+/);
        if (!match) return false;
        return parseFloat(match[0]) === parseFloat(userConfig.workload_val);
    }

    // 5. 纯动作执行流
    function executePureFillAction(showFlash = true) {
        // 1. 同步出差和住宿
        clickTravelCheckbox(userConfig.fill_travel, showFlash);
        clickButtonByLabelText('住宿情况', DICTS.houseType[userConfig.target_houseType], showFlash);
        
        // 2. 直接无视任何标签拦截，直接点击指定的“计划”项（计划内 或 计划外）
        clickButtonByLabelText('计划', DICTS.plan[userConfig.target_plan], showFlash);
        
        // 🌟 【核心修复】直接无条件点击“范围”对应的合同内/合同外，确保绝对触发勾选
        clickButtonByLabelText('范围', DICTS.fgWithinContract[userConfig.target_fgWithinContract], showFlash);

        // 3. 执行其余通用下拉或单选
        const tasks = [{ key: 'role', title: '角色' }, { key: 'model', title: '方式' }, { key: 'category', title: '类别' }, { key: 'result', title: '结果' }];
        tasks.forEach(task => { 
            clickButtonByLabelText(task.title, DICTS[task.key][userConfig[`target_${task.key}`]], showFlash);
        });
        
        // 4. 填充工时
        fillWorkloadViaButtons(userConfig.workload_val, showFlash);
    }

    // 6. 状态监控数据流
    function scanRealPageStatusMatrix() {
        const matrixResults = [];
        matrixResults.push({ name: '🚢 出差状态', status: checkTravelStatus() === userConfig.fill_travel ? '✅ 已同步' : '⚡ 差异' });
        
        const houseOk = checkItemStatus('住宿情况', DICTS.houseType[userConfig.target_houseType]);
        matrixResults.push({ name: '🏨 住宿安排', status: houseOk ? '✅ 匹配成功' : '⚡ 差异' });
        
        const planOk = checkItemStatus('计划', DICTS.plan[userConfig.target_plan]);
        matrixResults.push({ name: '📅 计划类型', status: planOk ? '✅ 匹配成功' : '⚡ 差异' });

        const scopeOk = checkItemStatus('范围', DICTS.fgWithinContract[userConfig.target_fgWithinContract]);
        matrixResults.push({ name: '📌 合同范围', status: scopeOk ? '✅ 匹配成功' : '⚡ 差异' });

        const tasks = [{ key: 'role', title: '角色', icon: '👤' }, { key: 'model', title: '方式', icon: '🌐' }, { key: 'category', title: '类别', icon: '📁' }, { key: 'result', title: '结果', icon: '🏁' }];
        tasks.forEach(task => { 
            const isOk = checkItemStatus(task.title, DICTS[task.key][userConfig[`target_${task.key}`]]);
            matrixResults.push({ name: `${task.icon} ${task.title}选择`, status: isOk ? '✅ 匹配成功' : '⚡ 差异' }); 
        });
        
        const wlOk = checkRealWorkloadStatus();
        matrixResults.push({ name: '⏳ 日志工时', status: wlOk ? '✅ 匹配成功' : '❌ 差异' });

        return matrixResults;
    }

    // 7. 中央控制流
    function runUnifiedWorkflow(executeAction = true, showFlash = true) {
        if (executeAction) {
            isWorkflowActive = true; 
            executePureFillAction(showFlash);
        }
        
        setTimeout(() => {
            const currentMatrix = scanRealPageStatusMatrix();
            if (userConfig.auto_run || isWorkflowActive) {
                renderUnifiedFeedbackPanel(currentMatrix);
            }
            isWorkflowActive = false; 
        }, 250);
    }

    // 8. 特权微操释放
    function runSingleFieldWithPrivilege(actionFn) {
        isWorkflowActive = true; 
        actionFn();
        setTimeout(() => { isWorkflowActive = false; }, 50);
    }

    // 9. 状态栏面板
    function renderUnifiedFeedbackPanel(results) {
        const oldPanel = document.getElementById('fill-unified-matrix-panel'); 
        if (oldPanel && oldPanel.parentNode) oldPanel.parentNode.removeChild(oldPanel);

        const panel = document.createElement('div');
        panel.id = 'fill-unified-matrix-panel';
        Object.assign(panel.style, { position: 'fixed', bottom: '140px', right: '30px', backgroundColor: 'rgba(255, 255, 255, 0.98)', backdropFilter: 'blur(12px)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '12px', padding: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.15)', zIndex: '2147483646', width: '210px', display: 'flex', flexDirection: 'column', gap: '5px', transition: 'all 0.3s ease', animation: 'fillFadeIn 0.25s cubic-bezier(0.2, 0.8, 0.2, 1) forwards' });

        let innerHTML = `<div style="font-size:11px; color:#999; font-weight:bold; border-bottom:1px solid #eee; padding-bottom:4px; margin-bottom:4px; display:flex; justify-content:space-between;"><span>📊 集中监控矩阵</span><span>V2.1</span></div>`;

        results.forEach(r => {
            let textColor = '#52c41a'; 
            if (r.status.includes('⚡') || r.status.includes('差异') || r.status.includes('❌')) textColor = '#faad14'; 
            if (r.status.includes('⏳')) textColor = '#faad14'; 
            innerHTML += `<div class="matrix-item" style="color: ${textColor};"><span>${r.name}</span><span>${r.status}</span></div>`;
        });

        panel.innerHTML = innerHTML;
        document.body.appendChild(panel);
        setTimeout(() => {
            panel.style.animation = 'fillFadeOut 0.25s cubic-bezier(0.2, 0.8, 0.2, 1) forwards';
            setTimeout(() => { if (panel && panel.parentNode) panel.parentNode.removeChild(panel); }, 250);
        }, 4500);
    }

    // 🌟 关于弹窗
    function showAboutModal() {
        const oldModal = document.getElementById('fill-about-modal');
        if (oldModal && oldModal.parentNode) {
            oldModal.parentNode.removeChild(oldModal);
        }

        const mask = document.createElement('div');
        mask.id = 'fill-about-modal';
        Object.assign(mask.style, { 
            position: 'fixed', 
            top: '0', 
            left: '0', 
            width: '100vw', 
            height: '100vh', 
            backgroundColor: 'rgba(0,0,0,0.3)', 
            backdropFilter: 'blur(4px)', 
            zIndex: '2147483648', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            animation: 'fillFadeIn 0.2s ease-out' 
        });

        const box = document.createElement('div');
        Object.assign(box.style, { 
            backgroundColor: '#fff', 
            padding: '20px', 
            borderRadius: '12px', 
            boxShadow: '0 10px 30px rgba(0,0,0,0.2)', 
            width: '280px', 
            textAlign: 'center', 
            position: 'relative' 
        });

        box.innerHTML = `
            <div style="font-size: 24px; margin-bottom: 8px;">⚙️</div>
            <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #111;">Bsoft 日志自动填充工具</h3>
            <div style="text-align: left; background: #f5f5f5; padding: 12px; border-radius: 8px; font-size: 12px; margin-bottom: 15px; display:flex; flex-direction:column; gap:6px;">
                <div style="color:#666;">📌 <b>版本：</b><span style="color:#222; font-weight:600;">V2.1</span></div>
                <div style="color:#444;">✍️ <b>作者：</b><span style="color:#1890ff; font-weight:bold;">IHIYA</span></div>
                <div style="color:#444; display:flex; align-items:center; gap:2px; white-space:nowrap;">
                    <span>🌐 <b>开源地址：</b></span>
                    <a href="https://github.com/wubai67-debug/Bsoft_Log_Tool" target="_blank" style="color:#1296db; text-decoration:none; font-weight:600;">点击访问 GitHub 仓库</a>
                </div>
            </div>
            <button id="fill-modal-close-btn" style="width: 100%; padding: 8px; border: none; background: #1890ff; color: #fff; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: bold;">确 定</button>
        `;

        mask.appendChild(box);
        document.body.appendChild(mask);

        const closeModal = () => { if (mask && mask.parentNode) mask.parentNode.removeChild(mask); };
        
        mask.onclick = closeModal;
        document.getElementById('fill-modal-close-btn').onclick = closeModal;
        box.onclick = (e) => e.stopPropagation(); 
    }

    // 10. 设置面板
    function toggleConfigPanel() {
        const panel = document.getElementById('fill-config-panel');
        if (panel) { 
            if (panel.parentNode) panel.parentNode.removeChild(panel); 
            return; 
        }
        const newPanel = document.createElement('div');
        newPanel.id = 'fill-config-panel';
        newPanel.className = 'panel-in';
        Object.assign(newPanel.style, { position: 'fixed', bottom: '130px', right: '30px', backgroundColor: '#fff', border: '1px solid #ddd', padding: '15px', borderRadius: '12px', zIndex: '2147483647', boxShadow: '0 10px 30px rgba(0,0,0,0.15)', width: '270px' });

        let html = `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom:1px solid #eee; padding-bottom:8px;"><h4 style="margin:0; font-size:15px; color:#111;">日志填充设置</h4><span style="font-size:10px; color:#1890ff; font-weight:bold;">V2.1</span></div>`;

        const getDynamicLabel = (isOn, sec) => {
            return isOn 
                ? `⚡ 进入页面第<span class="delay-text-badge">${sec}s</span>自动运行`
                : `💤 已关闭进入页面自动运行`;
        };
        const rowBgColor = userConfig.auto_run ? '#e6f7ff' : '#f5f5f5';
        const rowBorderColor = userConfig.auto_run ? '#91d5ff' : '#d9d9d9';
        const labelTextColor = userConfig.auto_run ? '#0050b3' : '#8c8c8c';

        html += `<div id="auto_run_wrapper" style="margin-bottom:12px; background:${rowBgColor}; padding:10px; border-radius:8px; border:1px solid ${rowBorderColor}; transition: all 0.2s ease;">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                        <label id="lbl_auto_run_title" class="config-label" style="color:${labelTextColor}; flex: 1; min-width: 170px; display: inline-block;">
                            ${getDynamicLabel(userConfig.auto_run, userConfig.init_delay)}
                        </label>
                        <input type="checkbox" id="cfg_auto_run" ${userConfig.auto_run ? 'checked' : ''} style="width:20px; height:20px; cursor:pointer; accent-color:#1890ff;">
                    </div>
                    <div class="desc-text" style="border-left-color:#1890ff; margin-bottom:8px; background: rgba(255,255,255,0.6);">由于网页加载需要时间，建议设置 1-3 秒延迟，确保数据精准勾选。</div>
                    <div class="range-container">
                        <input type="range" id="cfg_init_delay" min="1" max="10" step="1" value="${userConfig.init_delay}" class="range-input-style" ${userConfig.auto_run ? '' : 'disabled'}>
                        <div class="range-ticks">
                            <span>1s</span><span>2s</span><span>3s</span><span>4s</span><span>5s</span><span>6s</span><span>7s</span><span>8s</span><span>9s</span><span>10s</span>
                        </div>
                    </div>
                 </div>`;

        html += `<div class="config-row" style="background:#f6ffed; padding:10px; border-radius:8px; border:1px solid #b7eb8f; margin-bottom:12px;"><label class="config-label">🚢 是否出差</label><input type="checkbox" id="cfg_fill_travel" ${userConfig.fill_travel ? 'checked' : ''} style="width:20px; height:20px; cursor:pointer; accent-color:#52c41a;"></div>`;

        const configKeys = [{ id: 'houseType', label: '🏨 住宿', title: '住宿情况' }, { id: 'fgWithinContract', label: '📌 范围', title: '范围' }, { id: 'plan', label: '📅 计划', title: '计划' }, { id: 'role', label: '👤 角色', title: '角色' }, { id: 'model', label: '🌐 方式', title: '方式' }, { id: 'category', label: '📁 类别', title: '类别' }, { id: 'result', label: '🏁 结果', title: '结果' }];
        configKeys.forEach(item => {
            html += `<div class="config-row"><label class="config-label">${item.label}</label><div style="flex:1;"><select class="auto-save-cfg config-select" data-id="${item.id}" data-title="${item.title}">`;
            for (let val in DICTS[item.id]) { html += `<option value="${val}" ${userConfig[`target_${item.id}`] === val ? 'selected' : ''}>${DICTS[item.id][val]}</option>`; }
            html += `</select></div></div>`;
        });

        html += `<div class="config-row" style="margin-top:10px; padding-top:10px; border-top:1px dashed #eee; justify-content: space-between;">
                    <div style="display:flex; align-items:center; gap: 8px;">
                        <label class="config-label" style="min-width:32px;">⏳ 工时</label>
                        <div style="display:flex; align-items:center; background:#f5f5f5; border-radius:6px; padding:3px;">
                            <button id="btn_wl_minus" style="width:28px; height:26px; border:none; background:none; cursor:pointer; font-weight:bold; font-size:18px; color:#666;">-</button>
                            <input type="text" id="cfg_workload_val" value="${userConfig.workload_val}" style="width:40px; border:none; background:none; text-align:center; font-size:14px; font-weight:900; color:#52c41a; outline:none;">
                            <button id="btn_wl_plus" style="width:28px; height:26px; border:none; background:none; cursor:pointer; font-weight:bold; font-size:18px; color:#666;">+</button>
                        </div>
                    </div>
                    <button id="btn_open_about" class="about-btn" style="padding-right:0;">关于我</button>
                 </div>`;

        newPanel.innerHTML = html;
        document.body.appendChild(newPanel);

        document.getElementById('btn_open_about').onclick = showAboutModal;

        const chkAutoRun = document.getElementById('cfg_auto_run');
        const rangeDelay = document.getElementById('cfg_init_delay');
        const lblTitle = document.getElementById('lbl_auto_run_title');
        const wrapper = document.getElementById('auto_run_wrapper');

        const updateAutoRunUI = () => {
            const isChecked = chkAutoRun.checked;
            const delayVal = rangeDelay.value;
            
            userConfig.auto_run = isChecked;
            userConfig.init_delay = parseInt(delayVal);
            saveConfig();

            lblTitle.innerHTML = getDynamicLabel(isChecked, delayVal);
            if (isChecked) {
                rangeDelay.disabled = false;
                wrapper.style.background = '#e6f7ff';
                wrapper.style.borderColor = '#91d5ff';
                lblTitle.style.color = '#0050b3';
            } else {
                rangeDelay.disabled = true;
                wrapper.style.background = '#f5f5f5';
                wrapper.style.borderColor = '#d9d9d9';
                lblTitle.style.color = '#8c8c8c';
            }
        };

        chkAutoRun.onchange = updateAutoRunUI;
        rangeDelay.oninput = updateAutoRunUI;
        
        document.getElementById('cfg_fill_travel').onchange = (e) => { 
            userConfig.fill_travel = e.target.checked; 
            saveConfig(); 
            runSingleFieldWithPrivilege(() => { clickTravelCheckbox(userConfig.fill_travel, true); });
        };
        
        newPanel.querySelectorAll('.auto-save-cfg').forEach(select => {
            select.onchange = (e) => { 
                const id = e.target.getAttribute('data-id'); 
                const title = e.target.getAttribute('data-title');
                userConfig[`target_${id}`] = e.target.value; 
                saveConfig(); 
                runSingleFieldWithPrivilege(() => { clickButtonByLabelText(title, DICTS[id][userConfig[`target_${id}`]], true); });
            };
        });

        const wlInput = document.getElementById('cfg_workload_val');
        wlInput.oninput = (e) => { userConfig.workload_val = e.target.value.replace(/[^\d.]/g, ""); saveConfig(); };
        wlInput.onblur = (e) => { 
            let num = parseFloat(e.target.value); 
            let formatted = (isNaN(num) ? 8.0 : num).toFixed(1); 
            e.target.value = formatted; userConfig.workload_val = formatted; saveConfig(); 
            runSingleFieldWithPrivilege(() => { fillWorkloadViaButtons(formatted, true); });
        };
        document.getElementById('btn_wl_minus').onclick = () => { 
            let res = (Math.max(0, parseFloat(userConfig.workload_val) - 1.0)).toFixed(1); 
            wlInput.value = res; userConfig.workload_val = res; saveConfig(); 
            runSingleFieldWithPrivilege(() => { fillWorkloadViaButtons(res, true); });
        };
        document.getElementById('btn_wl_plus').onclick = () => { 
            let res = (parseFloat(userConfig.workload_val) + 1.0).toFixed(1); 
            wlInput.value = res; userConfig.workload_val = res; saveConfig(); 
            runSingleFieldWithPrivilege(() => { fillWorkloadViaButtons(res, true); });
        };
    }

    // 11. 悬浮底座基础初始化
    function createButton() {
        if (document.getElementById('fill-btn-group')) return;
        const group = document.createElement('div');
        group.id = 'fill-btn-group';
        Object.assign(group.style, { position: 'fixed', bottom: '70px', right: '30px', zIndex: '2147483647', display: 'flex', backgroundColor: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(12px)', padding: '5px', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.3)' });
        const mainBtn = document.createElement('button');
        mainBtn.className = 'fill-btn-hover'; mainBtn.innerHTML = '🚀 自动填充';
        Object.assign(mainBtn.style, { padding: '10px 18px', backgroundColor: '#52c41a', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' });
        const cfgBtn = document.createElement('button');
        cfgBtn.className = 'fill-btn-hover'; cfgBtn.innerHTML = '⚙️';
        Object.assign(cfgBtn.style, { padding: '0 12px', backgroundColor: 'transparent', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '18px' });
        addClickEffect(mainBtn); addClickEffect(cfgBtn);
        
        mainBtn.onclick = () => { runUnifiedWorkflow(true, true); };
        cfgBtn.onclick = toggleConfigPanel;
        group.appendChild(mainBtn); group.appendChild(cfgBtn);
        document.body.appendChild(group);
    }

    setInterval(createButton, 1000);

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['logFillConfig_v7'], function(result) {
            if (result && result.logFillConfig_v7) { 
                userConfig = result.logFillConfig_v7; 
            }
            if (userConfig.auto_run) {
                setTimeout(() => { 
                    runUnifiedWorkflow(true, true); 
                }, (userConfig.init_delay + 0.3) * 1000);
            }
        });
    }
})();