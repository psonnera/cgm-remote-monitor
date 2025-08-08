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
      <table class="table-ai-usage" style="width: auto; border-collapse: collapse;">
        <thead>
          <tr>
            <th rowspan="2" style="vertical-align: bottom;">${client.translate('Month')}</th>
            <th rowspan="2" style="vertical-align: bottom;">${client.translate('Requests')}</th>
            <th rowspan="2" style="vertical-align: bottom;">${client.translate('Total Days')}</th>
            <th rowspan="2" style="vertical-align: bottom;">${client.translate('Avg Days/Req')}</th>
            <th colspan="3">${client.translate('Total Tokens')}</th>
            <th colspan="3">${client.translate('Avg Tokens/Req')}</th>
            <th colspan="3">${client.translate('Avg Tokens/Day')}</th>
            <th colspan="3">${client.translate('Costs')}</th>
          </tr>
          <tr>
            <th>${client.translate('Input')}</th>
            <th>${client.translate('Output')}</th>
            <th>${client.translate('Total')}</th>
            <th>${client.translate('Input')}</th>
            <th>${client.translate('Output')}</th>
            <th>${client.translate('Total')}</th>
            <th>${client.translate('Input')}</th>
            <th>${client.translate('Output')}</th>
            <th>${client.translate('Total')}</th>
            <th>${client.translate('Total Costs')}</th>
            <th>${client.translate('Avg Costs/Req')}</th>
            <th>${client.translate('Avg Costs/Day')}</th>
          </tr>
        </thead>
        <tbody>
    `;

        monthlyData.forEach(function (monthEntry) {
            tableHtml += `
        <tr>
          <td>${monthEntry.month}</td>
          <td>${monthEntry.requests}</td>
          <td>${monthEntry.total_days_requested}</td>
          <td>${parseFloat(monthEntry.avg_days_per_request).toFixed(2)}</td>

          <td>${monthEntry.total_prompt_tokens}</td>
          <td>${monthEntry.total_completion_tokens}</td>
          <td>${monthEntry.total_tokens}</td>

          <td>${parseFloat(monthEntry.avg_prompt_tokens_per_request).toFixed(0)}</td>
          <td>${parseFloat(monthEntry.avg_completion_tokens_per_request).toFixed(0)}</td>
          <td>${parseFloat(monthEntry.avg_tokens_per_request).toFixed(0)}</td>

          <td>${parseFloat(monthEntry.avg_prompt_tokens_per_day).toFixed(0)}</td>
          <td>${parseFloat(monthEntry.avg_completion_tokens_per_day).toFixed(0)}</td>
          <td>${parseFloat(monthEntry.avg_tokens_per_day).toFixed(0)}</td>

          <td>$${parseFloat(monthEntry.total_cost).toFixed(4)}</td>
          <td>$${parseFloat(monthEntry.avg_cost_per_request).toFixed(4)}</td>
          <td>$${parseFloat(monthEntry.avg_cost_per_day).toFixed(4)}</td>
        </tr>
      `;
        });

        tableHtml += `
        </tbody>
        <tfoot>
          <tr style="font-weight: bold;">
            <td>${client.translate('Total')}</td>
            <td>${totalData.requests || 0}</td>
            <td>${totalData.total_days_requested || 0}</td>
            <td>${parseFloat(totalData.avg_days_per_request || 0).toFixed(2)}</td>

            <td>${totalData.total_prompt_tokens || 0}</td>
            <td>${totalData.total_completion_tokens || 0}</td>
            <td>${totalData.total_tokens || 0}</td>

            <td>${parseFloat(totalData.avg_prompt_tokens_per_request || 0).toFixed(0)}</td>
            <td>${parseFloat(totalData.avg_completion_tokens_per_request || 0).toFixed(0)}</td>
            <td>${parseFloat(totalData.avg_tokens_per_request || 0).toFixed(0)}</td>

            <td>${parseFloat(totalData.avg_prompt_tokens_per_day || 0).toFixed(0)}</td>
            <td>${parseFloat(totalData.avg_completion_tokens_per_day || 0).toFixed(0)}</td>
            <td>${parseFloat(totalData.avg_tokens_per_day || 0).toFixed(0)}</td>

            <td>$${parseFloat(totalData.total_cost || 0).toFixed(4)}</td>
            <td>$${parseFloat(totalData.avg_cost_per_request || 0).toFixed(4)}</td>
            <td>$${parseFloat(totalData.avg_cost_per_day || 0).toFixed(4)}</td>
          </tr>
        </tfoot>
      </table>
      <p><em>${client.translate('Note: Token counts are based on information returned by the LLM API.')}</em></p>
      <style>
         .table-ai-usage {
           margin: 20px 0;
         }
        .table-ai-usage th, 
        .table-ai-usage td {
            padding: 10px;
            text-align: left;
            min-width: 80px;
            border: 1px solid;
        }
        .table-ai-usage tr:nth-child(even) {
            background-color: lightslategrey;
            color: black;
        }
        .table-ai-usage th,
         .table-ai-usage tfoot td {
            background-color: lightskyblue;
            color: black;
        }
      </style>
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
            success: function (data) {
                $(statusId).html('');
                renderUsageTable(client, placeholderId, data);
            },
            error: function (jqXHR, textStatus, errorThrown) {
                console.error("AI Eval: [Admin] Error fetching AI usage summary:", textStatus, errorThrown);
                $(statusId).html('');
                $(placeholderId).html(`<p style="color: red;">${client.translate('Error fetching AI usage data: ')} ${textStatus}</p><p>${client.translate('Ensure you have appropriate permissions (e.g., admin or a role with api:treatments:read).')}</p>`);
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

                init: function (client) {
                    const $ = window.jQuery;
                    if (typeof $ !== 'function') {
                        console.error('AI Eval: [Admin] jQuery is not available!');
                        return;
                    }
                    const placeholderId = `#admin_${pluginName}_0_html`;
                    const statusId = `#admin_${pluginName}_0_status`;
                    fetchUsageData(client, placeholderId, statusId);
                },

                code: function (client) {
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
