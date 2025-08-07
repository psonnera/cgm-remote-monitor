'use strict';

// Admin plugin for AI Usage Statistics
function init(ctx) {
  const pluginName = 'AIUsageViewerAdmin';

  // Helper functions defined in a shared scope
  const renderUsageTable = (client, placeholderId, data) => {
    const $ = window.jQuery;
    const monthlyData = data.monthly || [];
    const totalData = data.total || {};

    if (monthlyData.length === 0) {
      $(placeholderId).html(`<p>${client.translate('No AI usage data available yet.')}</p>`);
      return;
    }

    let tableHtml = `
      <table class="table table-striped table-bordered" style="width: auto;">
        <thead>
          <tr>
            <th>${client.translate('Month')}</th>
            <th>${client.translate('Requests')}</th>
            <th>${client.translate('Total Days')}</th>
            <th>${client.translate('Avg Days/Req')}</th>
            <th>${client.translate('Total Tokens')}</th>
            <th>${client.translate('Avg Tokens/Req')}</th>
            <th>${client.translate('Avg Tokens/Day')}</th>
          </tr>
        </thead>
        <tbody>
    `;

    monthlyData.forEach(function(monthEntry) {
      tableHtml += `
        <tr>
          <td>${client.escape(monthEntry.month)}</td>
          <td>${client.escape(monthEntry.requests)}</td>
          <td>${client.escape(monthEntry.total_days_requested)}</td>
          <td>${client.escape(parseFloat(monthEntry.avg_days_per_request).toFixed(2))}</td>
          <td>${client.escape(monthEntry.total_tokens)}</td>
          <td>${client.escape(parseFloat(monthEntry.avg_tokens_per_request).toFixed(0))}</td>
          <td>${client.escape(parseFloat(monthEntry.avg_tokens_per_day).toFixed(0))}</td>
        </tr>
      `;
    });

    tableHtml += `
        </tbody>
        <tfoot>
          <tr style="font-weight: bold;">
            <td>${client.translate('Total')}</td>
            <td>${client.escape(totalData.requests || 0)}</td>
            <td>${client.escape(totalData.total_days_requested || 0)}</td>
            <td>${client.escape(parseFloat(totalData.avg_days_per_request || 0).toFixed(2))}</td>
            <td>${client.escape(totalData.total_tokens || 0)}</td>
            <td>${client.escape(parseFloat(totalData.avg_tokens_per_request || 0).toFixed(0))}</td>
            <td>${client.escape(parseFloat(totalData.avg_tokens_per_day || 0).toFixed(0))}</td>
          </tr>
        </tfoot>
      </table>
      <p><em>${client.translate('Note: Token counts are based on information returned by the LLM API.')}</em></p>
    `;
    $(placeholderId).html(tableHtml);
  };

  const fetchUsageData = (client, placeholderId, statusId) => {
    const $ = window.jQuery;
    $(statusId).html(client.translate('Loading usage data...'));
    $(placeholderId).empty();

    $.ajax({
      url: client.settings.baseURL + '/api/v1/ai_usage/monthly_summary',
      type: 'GET',
      headers: client.headers(),
      success: function(data) {
        $(statusId).html('');
        renderUsageTable(client, placeholderId, data);
      },
      error: function(jqXHR, textStatus, errorThrown) {
        console.error("Error fetching AI usage summary:", textStatus, errorThrown);
        $(statusId).html('');
        $(placeholderId).html(`<p style="color: red;">${client.translate('Error fetching AI usage data: ')} ${client.escape(textStatus)}</p><p>${client.translate('Ensure you have appropriate permissions (e.g., admin or a role with api:treatments:read).')}</p>`);
      }
    });
  };


  const plugin = {
    name: pluginName,
    label: 'AI Usage Statistics',
    actions: [
      {
        name: 'View Monthly Usage',
        description: 'Displays monthly token consumption and API call counts for the AI Evaluation feature.',
        buttonLabel: 'Refresh Data',

        init: function(client) {
          const $ = window.jQuery;
          if (typeof $ !== 'function') {
            console.error('[AIUsageViewerAdmin] jQuery is not available!');
            return;
          }
          const placeholderId = `#admin_${pluginName}_0_html`;
          const statusId = `#admin_${pluginName}_0_status`;
          fetchUsageData(client, placeholderId, statusId);
        },

        code: function(client) {
          const placeholderId = `#admin_${pluginName}_0_html`;
          const statusId = `#admin_${pluginName}_0_status`;
          fetchUsageData(client, placeholderId, statusId);
        }
      }
    ]
  };

  return plugin;
}

module.exports = init;
