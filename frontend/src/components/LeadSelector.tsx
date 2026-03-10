import type { Lead } from '../types';

interface LeadSelectorProps {
  leads: Lead[];
  selectedLead: Lead | null;
  onSelectLead: (lead: Lead | null) => void;
  isLoading: boolean;
}

export function LeadSelector({
  leads,
  selectedLead,
  onSelectLead,
  isLoading,
}: LeadSelectorProps) {
  return (
    <div className="relative">
      <select
        className="input min-w-[300px] appearance-none pr-10"
        value={selectedLead?.id || ''}
        onChange={(e) => {
          const lead = leads.find((l) => l.id === e.target.value);
          onSelectLead(lead || null);
        }}
        disabled={isLoading}
      >
        <option value="">
          {isLoading ? 'Loading leads...' : 'Select a lead'}
        </option>
        {leads.map((lead) => (
          <option key={lead.id} value={lead.id}>
            {lead.name} {lead.phone ? `(${lead.phone})` : ''}
          </option>
        ))}
      </select>
      <div className="absolute right-3 top-1/2 transform -translate-y-1/2 pointer-events-none">
        <svg
          className="w-5 h-5 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </div>
    </div>
  );
}
