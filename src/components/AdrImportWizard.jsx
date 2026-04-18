import React, { useState, useRef, useCallback } from 'react';
import { FileSpreadsheet, Upload, X, ChevronRight, ChevronLeft, Check, AlertCircle, FileType } from 'lucide-react';
import * as XLSX from 'xlsx';

const STEPS = [
  { id: 'upload', label: 'Carica File' },
  { id: 'preview', label: 'Anteprima Dati' },
  { id: 'mapping', label: 'Mappatura Colonne' },
  { id: 'validate', label: 'Validazione' },
  { id: 'import', label: 'Importa' }
];

const DEFAULT_COLUMN_MAP = {
  progressivo: null,
  timeIn: null,
  timeOut: null,
  battuta: null,
  personaggio: null
};

const AdrImportWizard = ({ isOpen, onClose, onImportCues }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [file, setFile] = useState(null);
  const [rawData, setRawData] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [columnMap, setColumnMap] = useState(DEFAULT_COLUMN_MAP);
  const [parsedData, setParsedData] = useState([]);
  const [validationErrors, setValidationErrors] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  const resetState = useCallback(() => {
    setCurrentStep(0);
    setFile(null);
    setRawData([]);
    setHeaders([]);
    setColumnMap(DEFAULT_COLUMN_MAP);
    setParsedData([]);
    setValidationErrors([]);
    setIsDragging(false);
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  const parseTimecode = (value) => {
    if (value === null || value === undefined || value === '') return null;
    
    // Se è già un numero, assumiamo siano secondi
    if (typeof value === 'number') return value;
    
    // Se è un oggetto Date (Excel può convertire timecode in Date)
    if (value instanceof Date) {
      return value.getHours() * 3600 + value.getMinutes() * 60 + value.getSeconds() + value.getMilliseconds() / 1000;
    }
    
    const str = String(value).trim();
    
    // Pattern HH:MM:SS:FF (drop-frame non supportato, trattato come normale)
    const smptePattern = /^(\d{1,2}):(\d{2}):(\d{2}):(\d{2})$/;
    const smpteMatch = str.match(smptePattern);
    if (smpteMatch) {
      const hours = parseInt(smpteMatch[1], 10);
      const minutes = parseInt(smpteMatch[2], 10);
      const seconds = parseInt(smpteMatch[3], 10);
      const frames = parseInt(smpteMatch[4], 10);
      
      if (minutes >= 60 || seconds >= 60 || frames >= 30) return null;
      
      // Converti a secondi (assumendo 25fps)
      return hours * 3600 + minutes * 60 + seconds + frames / 25;
    }
    
    // Pattern HH:MM:SS.mmm o HH:MM:SS
    const timePattern = /^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/;
    const timeMatch = str.match(timePattern);
    if (timeMatch) {
      const hours = parseInt(timeMatch[1], 10);
      const minutes = parseInt(timeMatch[2], 10);
      const seconds = parseInt(timeMatch[3], 10);
      const millis = timeMatch[4] ? parseInt(timeMatch[4].padEnd(3, '0'), 10) : 0;
      
      if (minutes >= 60 || seconds >= 60) return null;
      
      return hours * 3600 + minutes * 60 + seconds + millis / 1000;
    }
    
    // Pattern MM:SS.mmm o MM:SS
    const shortPattern = /^(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/;
    const shortMatch = str.match(shortPattern);
    if (shortMatch) {
      const minutes = parseInt(shortMatch[1], 10);
      const seconds = parseInt(shortMatch[2], 10);
      const millis = shortMatch[3] ? parseInt(shortMatch[3].padEnd(3, '0'), 10) : 0;
      
      if (seconds >= 60) return null;
      
      return minutes * 60 + seconds + millis / 1000;
    }
    
    // Prova a parsare come numero
    const num = parseFloat(str);
    if (!isNaN(num) && isFinite(num) && num >= 0) return num;
    
    return null;
  };

  const validateTimecode = (value) => {
    const parsed = parseTimecode(value);
    return parsed !== null && parsed >= 0;
  };

  const handleFileSelect = useCallback((selectedFile) => {
    if (!selectedFile) return;
    
    const validExtensions = ['.xlsx', '.xls', '.csv'];
    const ext = selectedFile.name.slice(selectedFile.name.lastIndexOf('.')).toLowerCase();
    
    if (!validExtensions.includes(ext)) {
      alert('Formato file non supportato. Usa .xlsx, .xls o .csv');
      return;
    }
    
    setFile(selectedFile);
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
        
        if (jsonData.length === 0) {
          alert('Il file è vuoto');
          return;
        }
        
        // Estrai headers dalla prima riga
        const rawHeaders = jsonData[0].map((h, i) => ({
          index: i,
          name: String(h || `Colonna ${i + 1}`),
          sample: jsonData.slice(1, 4).map(row => row[i]).filter(v => v !== undefined)
        }));
        
        setHeaders(rawHeaders);
        // Mantieni TUTTE le righe includendo l'header per preservare gli indici
        // ma traccia separatamente quali righe sono dati vs header
        setRawData(jsonData);
        
        // Auto-detect colonne - SOLO timeIn, timeOut deve essere mappato manualmente
        const autoMap = { ...DEFAULT_COLUMN_MAP };
        rawHeaders.forEach(header => {
          const nameLower = header.name.toLowerCase();
          if (/num|prog|id|cue|#|n\.?\s*°/.test(nameLower)) autoMap.progressivo = header.index;
          // Solo pattern specifici per timeIn che NON possono confondersi con timeOut
          else if (/time\s*in|inizio|start|entrata|tc\s*in/.test(nameLower)) autoMap.timeIn = header.index;
          // timeOut NON viene auto-detectato - l'utente deve mapparlo manualmente
          else if (/testo|battuta|line|dialog|text|frase/.test(nameLower)) autoMap.battuta = header.index;
          else if (/char|pers|attore|actor|voice|role/.test(nameLower)) autoMap.personaggio = header.index;
        });
        setColumnMap(autoMap);
        
        setCurrentStep(1);
      } catch (err) {
        console.error('Errore parsing Excel:', err);
        alert('Errore durante la lettura del file. Verifica che sia un file Excel valido.');
      }
    };
    reader.readAsArrayBuffer(selectedFile);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) handleFileSelect(droppedFile);
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const validateAndParse = useCallback(() => {
    console.log('[ADR Debug] validateAndParse called');
    console.log('[ADR Debug] columnMap:', columnMap);
    console.log('[ADR Debug] rawData length:', rawData.length);
    console.log('[ADR Debug] rawData[0] (header):', rawData[0]);
    console.log('[ADR Debug] rawData[1] (first data row):', rawData[1]);
    
    if (columnMap.timeIn === null) {
      alert('Devi selezionare la colonna Timecode Inizio');
      return;
    }
    
    // Verifica che timeIn e timeOut non siano la stessa colonna
    if (columnMap.timeOut !== null && columnMap.timeIn === columnMap.timeOut) {
      alert('Timecode Inizio e Timecode Fine non possono essere la stessa colonna');
      return;
    }
    
    const errors = [];
    const parsed = [];
    
    // Salta la prima riga (header) quando si itera sui dati
    rawData.slice(1).forEach((row, idx) => {
      const rowNum = idx + 2; // +2 perché riga 1 è header
      
      // Verifica che la riga esista e abbia abbastanza colonne
      if (!row || row.length === 0) {
        console.log(`[ADR Debug] Row ${rowNum} is empty, skipping`);
        return;
      }
      
      const timeInValue = row[columnMap.timeIn];
      console.log(`[ADR Debug] Row ${rowNum} - timeInValue:`, timeInValue, 'from column', columnMap.timeIn);
      
      if (!validateTimecode(timeInValue)) {
        console.log(`[ADR Debug] Row ${rowNum} - timeInValue INVALID:`, timeInValue);
        errors.push({
          row: rowNum,
          field: 'timeIn',
          value: timeInValue,
          message: `Timecode inizio non valido: "${timeInValue}"`
        });
        return;
      }
      
      const timeIn = parseTimecode(timeInValue);
      console.log(`[ADR Debug] Row ${rowNum} - parsed timeIn:`, timeIn);
      
      // Parsing timeOut se mappato
      let timeOut = null;
      if (columnMap.timeOut !== null) {
        const timeOutValue = row[columnMap.timeOut];
        console.log(`[ADR Debug] Row ${rowNum} - timeOutValue:`, timeOutValue);
        if (timeOutValue !== null && timeOutValue !== undefined && timeOutValue !== '') {
          if (!validateTimecode(timeOutValue)) {
            console.log(`[ADR Debug] Row ${rowNum} - timeOutValue INVALID:`, timeOutValue);
            errors.push({
              row: rowNum,
              field: 'timeOut',
              value: timeOutValue,
              message: `Timecode fine non valido: "${timeOutValue ?? ''}"`
            });
            return;
          }
          timeOut = parseTimecode(timeOutValue);
          console.log(`[ADR Debug] Row ${rowNum} - parsed timeOut:`, timeOut);
          // Verifica che timeOut sia dopo timeIn
          if (timeOut <= timeIn) {
            errors.push({
              row: rowNum,
              field: 'timeOut',
              value: timeOutValue,
              message: `Timecode fine (${timeOutValue ?? ''}) deve essere dopo il timecode inizio (${timeInValue ?? ''})`
            });
            return;
          }
        }
      }
      
      const parsedItem = {
        progressivo: columnMap.progressivo !== null ? String(row[columnMap.progressivo] || '') : String(idx + 1),
        timeIn,
        timeOut,
        battuta: columnMap.battuta !== null ? String(row[columnMap.battuta] || '') : '',
        personaggio: columnMap.personaggio !== null ? String(row[columnMap.personaggio] || '') : ''
      };
      console.log(`[ADR Debug] Row ${rowNum} - parsed item:`, parsedItem);
      parsed.push(parsedItem);
    });
    
    console.log('[ADR Debug] Total parsed:', parsed.length, 'errors:', errors.length);
    setParsedData(parsed);
    setValidationErrors(errors);
    setCurrentStep(3);
  }, [rawData, columnMap]);

  const handleImport = useCallback(() => {
    const cues = parsedData.map((item, idx) => ({
      id: Date.now() + idx,
      timeIn: item.timeIn,
      timeOut: item.timeOut,
      character: item.personaggio,
      text: item.battuta,
      status: 'todo'
    }));
    
    onImportCues(cues);
    handleClose();
  }, [parsedData, onImportCues, handleClose]);

  const canProceed = () => {
    switch (currentStep) {
      case 1: return true;
      case 2: return columnMap.timeIn !== null;
      case 3: return validationErrors.length === 0 && parsedData.length > 0;
      default: return false;
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 0: // Upload
        return (
          <div className="wizard-upload-step">
            <div
              className={`upload-dropzone ${isDragging ? 'dragging' : ''}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={48} className="upload-icon" />
              <p className="upload-text">
                Trascina qui il file Excel o <span className="upload-link">clicca per selezionare</span>
              </p>
              <p className="upload-hint">
                Formati supportati: .xlsx, .xls, .csv
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => handleFileSelect(e.target.files[0])}
                style={{ display: 'none' }}
              />
            </div>
            
            <div className="wizard-info">
              <h4>Struttura file attesa:</h4>
              <p>Il file Excel deve contenere almeno una colonna con i timecode. Le colonne consigliate sono:</p>
              <ul>
                <li><strong>Progressivo:</strong> Numero identificativo del cue (opzionale)</li>
                <li><strong>Timecode Inizio:</strong> In punto del cue <em>(obbligatorio)</em></li>
                <li><strong>Timecode Fine:</strong> Out punto del cue (opzionale)</li>
                <li><strong>Battuta:</strong> Testo da doppiare (opzionale)</li>
                <li><strong>Personaggio:</strong> Nome del personaggio (opzionale)</li>
              </ul>
              <p className="format-hint">
                Formati timecode supportati: <code>HH:MM:SS:FF</code>, <code>HH:MM:SS.mmm</code>, <code>MM:SS</code>, o secondi
              </p>
            </div>
          </div>
        );
        
      case 1: // Preview
        return (
          <div className="wizard-preview-step">
            <div className="preview-info">
              <FileSpreadsheet size={20} />
              <span className="filename">{file?.name}</span>
              <span className="row-count">{Math.max(0, rawData.length - 1)} righe trovate</span>
            </div>
            
            <div className="preview-table-container">
              <table className="preview-table">
                <thead>
                  <tr>
                    {headers.map(h => (
                      <th key={h.index}>{h.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rawData.slice(1, 11).map((row, idx) => (
                    <tr key={idx}>
                      {headers.map(h => (
                        <td key={h.index}>{row[h.index] !== undefined ? String(row[h.index]) : ''}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {rawData.length > 11 && (
                <div className="preview-more">...e altre {rawData.length - 11} righe</div>
              )}
            </div>
          </div>
        );
        
      case 2: // Mapping
        return (
          <div className="wizard-mapping-step">
            <p className="mapping-instruction">
              Associa le colonne del tuo file ai campi dei cue. Solo <strong>Timecode</strong> è obbligatorio.
            </p>
            
            <div className="mapping-grid">
              <div className={`mapping-field ${columnMap.progressivo === null ? 'optional' : 'mapped'}`}>
                <label>Progressivo</label>
                <select
                  value={columnMap.progressivo ?? ''}
                  onChange={(e) => setColumnMap(m => ({ ...m, progressivo: e.target.value ? parseInt(e.target.value) : null }))}
                >
                  <option value="">-- Non mappare --</option>
                  {headers.map(h => (
                    <option key={h.index} value={h.index}>{h.name}</option>
                  ))}
                </select>
                <span className="field-hint">Numero identificativo del cue</span>
              </div>
              
              <div className={`mapping-field required ${columnMap.timeIn === null ? 'error' : 'mapped'}`}>
                <label>Timecode Inizio *</label>
                <select
                  value={columnMap.timeIn ?? ''}
                  onChange={(e) => setColumnMap(m => ({ ...m, timeIn: e.target.value ? parseInt(e.target.value) : null }))}
                >
                  <option value="">-- Seleziona colonna --</option>
                  {headers.map(h => (
                    <option key={h.index} value={h.index}>{h.name}</option>
                  ))}
                </select>
                <span className="field-hint">In punto del cue (obbligatorio)</span>
              </div>
              
              <div className={`mapping-field ${columnMap.timeOut === null ? 'optional' : 'mapped'}`}>
                <label>Timecode Fine</label>
                <select
                  value={columnMap.timeOut ?? ''}
                  onChange={(e) => setColumnMap(m => ({ ...m, timeOut: e.target.value ? parseInt(e.target.value) : null }))}
                >
                  <option value="">-- Non mappare --</option>
                  {headers.map(h => (
                    <option key={h.index} value={h.index}>{h.name}</option>
                  ))}
                </select>
                <span className="field-hint">Out punto del cue (opzionale)</span>
              </div>
              
              <div className={`mapping-field ${columnMap.battuta === null ? 'optional' : 'mapped'}`}>
                <label>Battuta / Testo</label>
                <select
                  value={columnMap.battuta ?? ''}
                  onChange={(e) => setColumnMap(m => ({ ...m, battuta: e.target.value ? parseInt(e.target.value) : null }))}
                >
                  <option value="">-- Non mappare --</option>
                  {headers.map(h => (
                    <option key={h.index} value={h.index}>{h.name}</option>
                  ))}
                </select>
                <span className="field-hint">Testo da doppiare</span>
              </div>
              
              <div className={`mapping-field ${columnMap.personaggio === null ? 'optional' : 'mapped'}`}>
                <label>Personaggio</label>
                <select
                  value={columnMap.personaggio ?? ''}
                  onChange={(e) => setColumnMap(m => ({ ...m, personaggio: e.target.value ? parseInt(e.target.value) : null }))}
                >
                  <option value="">-- Non mappare --</option>
                  {headers.map(h => (
                    <option key={h.index} value={h.index}>{h.name}</option>
                  ))}
                </select>
                <span className="field-hint">Nome del personaggio</span>
              </div>
            </div>
            
            <div className="mapping-preview">
              <h4>Anteprima mappatura:</h4>
              <div className="mapping-preview-row">
                <span className="preview-label">Riga 2:</span>
                <span className="preview-values">
                  {columnMap.progressivo !== null && (
                    <span className="preview-chip">
                      #{rawData[0]?.[columnMap.progressivo] || '1'}
                    </span>
                  )}
                  {columnMap.timeIn !== null && (
                    <span className="preview-chip timecode">
                      {rawData[0]?.[columnMap.timeIn] || '--:--:--:--'}
                    </span>
                  )}
                  {columnMap.timeOut !== null && (
                    <span className="preview-chip timecode-out">
                      → {rawData[0]?.[columnMap.timeOut] || '--:--:--:--'}
                    </span>
                  )}
                  {columnMap.personaggio !== null && (
                    <span className="preview-chip character">
                      {rawData[0]?.[columnMap.personaggio] || 'Personaggio'}
                    </span>
                  )}
                  {columnMap.battuta !== null && (
                    <span className="preview-chip text">
                      "{String(rawData[0]?.[columnMap.battuta] || '').slice(0, 50)}"
                    </span>
                  )}
                </span>
              </div>
            </div>
          </div>
        );
        
      case 3: // Validation
        return (
          <div className="wizard-validate-step">
            {validationErrors.length > 0 ? (
              <>
                <div className="validation-summary error">
                  <AlertCircle size={24} />
                  <div>
                    <strong>Trovati {validationErrors.length} errori</strong>
                    <p>Correggi gli errori nel file Excel e riprova.</p>
                  </div>
                </div>
                <div className="validation-errors">
                  {validationErrors.slice(0, 20).map((err, idx) => (
                    <div key={idx} className="error-item">
                      <span className="error-row">Riga {err.row}</span>
                      <span className="error-field">{err.field}</span>
                      <span className="error-value">"{err.value}"</span>
                      <span className="error-message">{err.message}</span>
                    </div>
                  ))}
                  {validationErrors.length > 20 && (
                    <div className="error-more">...e altri {validationErrors.length - 20} errori</div>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="validation-summary success">
                  <Check size={24} />
                  <div>
                    <strong>{parsedData.length} cue validi pronti per l'importazione</strong>
                    <p>Tutti i timecode sono stati validati correttamente.</p>
                  </div>
                </div>
                <div className="validation-preview">
                  <h4>Anteprima cue da importare:</h4>
                  <div className="cue-preview-list">
                    {parsedData.slice(0, 10).map((item, idx) => (
                      <div key={idx} className="cue-preview-item">
                        <span className="cue-num">#{item.progressivo}</span>
                        <span className="cue-tc">
                          {formatSeconds(item.timeIn)}
                          {item.timeOut !== null && ` → ${formatSeconds(item.timeOut)}`}
                        </span>
                        <span className="cue-char">{item.personaggio || '—'}</span>
                        <span className="cue-text" title={item.battuta}>
                          {item.battuta.slice(0, 40)}{item.battuta.length > 40 ? '...' : ''}
                        </span>
                      </div>
                    ))}
                    {parsedData.length > 10 && (
                      <div className="cue-more">...e altri {parsedData.length - 10} cue</div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        );
        
      default:
        return null;
    }
  };

  const formatSeconds = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const f = Math.floor((seconds % 1) * 25);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}:${f.toString().padStart(2, '0')}`;
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="wizard-modal">
        <div className="wizard-header">
          <div className="wizard-title">
            <FileType size={24} />
            <h2>Importa Cue ADR</h2>
          </div>
          <button className="wizard-close" onClick={handleClose}>
            <X size={20} />
          </button>
        </div>
        
        <div className="wizard-progress">
          {STEPS.map((step, idx) => (
            <div
              key={step.id}
              className={`progress-step ${idx === currentStep ? 'active' : ''} ${idx < currentStep ? 'completed' : ''}`}
            >
              <div className="step-number">{idx < currentStep ? <Check size={14} /> : idx + 1}</div>
              <span className="step-label">{step.label}</span>
            </div>
          ))}
        </div>
        
        <div className="wizard-content">
          {renderStepContent()}
        </div>
        
        <div className="wizard-footer">
          <button
            className="btn-wizard btn-secondary"
            onClick={currentStep === 0 ? handleClose : () => setCurrentStep(s => s - 1)}
          >
            {currentStep === 0 ? 'Annulla' : <><ChevronLeft size={16} /> Indietro</>}
          </button>
          
          {currentStep < STEPS.length - 1 && (
            <button
              className="btn-wizard btn-primary"
              onClick={() => {
                if (currentStep === 2) validateAndParse();
                else setCurrentStep(s => s + 1);
              }}
              disabled={!canProceed()}
            >
              {currentStep === 2 ? 'Valida' : 'Avanti'} <ChevronRight size={16} />
            </button>
          )}
          
          {currentStep === STEPS.length - 1 && validationErrors.length === 0 && (
            <button
              className="btn-wizard btn-success"
              onClick={handleImport}
            >
              <Check size={16} /> Importa {parsedData.length} Cue
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdrImportWizard;
